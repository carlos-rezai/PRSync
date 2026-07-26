import * as React from "react";
import {
  buildPrKey,
  deriveRole,
  hasEligibleReviewers,
  withSingleRetry,
} from "../lib";
import type { Phase } from "../lib";
import { usePanelState } from "../hooks";
import type { SdkClient } from "../sdk";
import type { ApiClient } from "../api";
import type { AdoClient } from "../ado";
import {
  ComposeForm,
  EmptyState,
  ErrorState,
  LoadingState,
  RefreshBanner,
  RoundView,
} from "../components";

// The panel container. It owns the load state machine and the Phase 2
// Done-toggle interaction, wiring the three injected clients (`sdk` /
// `api` / `ado`) into the views. Dependency injection is the testing
// seam — tests pass fakes; boot passes the real host-backed clients (see
// index.tsx).
//
// Load sequence (PRD #7 "Load sequence"):
//   getCurrentRound → 200 → derive the whole view from the round; NO ADO
//                           call.
//                   → 204 → one ADO `createdBy` read decides author
//                           (compose placeholder) vs. bystander (ZeroData).
//
// Done toggle (PRD #7 "Done toggle"): a reviewer flips their OWN row
// optimistically, `toggleDone` PATCHes, then the returned `Round` REPLACES
// panel state (authoritative — surfaces an auto-close the moment quorum is
// met). A generic failure reverts the flip with an inline message; a
// drift-class 409/403 maps (via `mapApiError`) to a re-fetch that
// self-heals the client to the true state.
//
// Ready for review (PRD #7 "Compose defaults"): when no round is open, the
// author gets the compose form instead of the read-only view. Clicking
// reads ADO's live PR AFRESH — the reviewer list is snapshotted at that
// instant, never from the load-time read — and only then calls
// `openRound`; the returned `Round` replaces panel state. A `422`
// `INSUFFICIENT_REVIEWERS` surfaces inline as the server-owned backstop to
// the client's `hasEligibleReviewers` gate.

// Label edit / Cancel round (PRD #7 Phase 4): the author's two management
// actions on an open round. `editLabel` sends the author's exact text and
// the returned `Round` replaces panel state (the API's stored wording
// wins). `cancelRound` silently abandons the round — reached only through
// a confirmation dialog — and the resulting terminal round hands the
// author straight to the compose form for round N+1. Both reuse the
// toggle's failure contract through `routeFailure`.

// Polling + drift (PRD #7 "Polling" / "Drift detection"): review is live
// team activity, so a ~20s poll re-reads the current round and compares a
// `roundFingerprint` against the viewer's BASELINE — the last
// authoritative state they saw or acted on (`commit`). A divergence is
// someone ELSE's change: it raises the refresh banner and nothing more,
// because the panel never live-patches state under a cursor. Clicking the
// banner is the only path that updates a drifted panel. The viewer's own
// mutations commit their result, which resets the baseline, so they can
// never raise the banner at themselves.

interface AppProps {
  sdk: SdkClient;
  api: ApiClient;
  ado: AdoClient;
}

export function App({ sdk, api, ado }: AppProps): React.ReactElement {
  const {
    state,
    mutationError,
    openError,
    opening,
    drifted,
    refresh,
    setState,
    setMutationError,
    setOpenError,
    setOpening,
    mutatingRef,
    commit,
    settle,
    routeFailure,
  } = usePanelState({ sdk, api, ado });

  async function handleToggleOwn(): Promise<void> {
    if (state.status !== "ready" || state.round === null) {
      return;
    }
    const currentRound = state.round;
    const currentPr = state.pr;
    const viewerAdoId = sdk.getUser().id;
    const me = currentRound.reviewers.find(
      (reviewer) => reviewer.adoId === viewerAdoId
    );
    if (me === undefined) {
      return;
    }
    const nextDone = !me.done;

    // Optimistic: flip the viewer's own row before the PATCH resolves.
    setMutationError(null);
    setState({
      status: "ready",
      round: {
        ...currentRound,
        reviewers: currentRound.reviewers.map((reviewer) =>
          reviewer.adoId === viewerAdoId
            ? { ...reviewer, done: nextDone }
            : reviewer
        ),
      },
      pr: currentPr,
    });

    mutatingRef.current = true;
    try {
      const updated = await withSingleRetry(() =>
        api.toggleDone(currentRound.prKey, currentRound.roundNumber, nextDone)
      );
      // Reconcile: the returned round is authoritative — a `closed` round
      // surfaces the auto-close and freezes the list.
      commit({ status: "ready", round: updated, pr: currentPr });
    } catch (error) {
      const message = await routeFailure(error);
      if (message !== null) {
        // Revert the optimistic flip and show the inline recovery message.
        // The baseline still holds the pre-flip round, which is exactly
        // what goes back on screen.
        setState({ status: "ready", round: currentRound, pr: currentPr });
        setMutationError(message);
      }
    } finally {
      mutatingRef.current = false;
    }
  }

  async function handleEditLabel(label: string): Promise<void> {
    if (state.status !== "ready" || state.round === null) {
      return;
    }
    const currentRound = state.round;
    const currentPr = state.pr;

    setMutationError(null);
    mutatingRef.current = true;
    try {
      // The author's typed text is already on screen, so there is no
      // optimistic write to revert — only the returned round to apply.
      const renamed = await withSingleRetry(() =>
        api.editLabel(currentRound.prKey, currentRound.roundNumber, label)
      );
      commit({ status: "ready", round: renamed, pr: currentPr });
    } catch (error) {
      const message = await routeFailure(error);
      if (message !== null) {
        setMutationError(message);
      }
    } finally {
      mutatingRef.current = false;
    }
  }

  async function handleCancelRound(): Promise<void> {
    if (state.status !== "ready" || state.round === null) {
      return;
    }
    const currentRound = state.round;

    setMutationError(null);
    mutatingRef.current = true;
    try {
      const cancelled = await withSingleRetry(() =>
        api.cancelRound(currentRound.prKey, currentRound.roundNumber)
      );
      // The cancelled round is terminal, so settling reads ADO's live PR
      // and the author lands straight on the compose form for round N+1.
      commit(await settle(cancelled));
    } catch (error) {
      const message = await routeFailure(error);
      if (message !== null) {
        setMutationError(message);
      }
    } finally {
      mutatingRef.current = false;
    }
  }

  async function handleOpenRound(
    phase: Phase,
    label: string | undefined
  ): Promise<void> {
    const parts = sdk.prKeyParts();
    setOpenError(null);
    setOpening(true);
    mutatingRef.current = true;
    try {
      // The authoritative snapshot is read HERE, at the click — never
      // reused from the load-time read that gated the button. Only the
      // round-open itself is retried, so a retry can never re-snapshot a
      // reviewer list that moved in between.
      const pr = await ado.getPullRequest(parts);
      const opened = await withSingleRetry(() =>
        api.openRound(buildPrKey(parts), {
          phase,
          reviewers: pr.reviewers,
          prTitle: pr.title,
          prUrl: pr.url,
          author: { name: pr.createdByName, email: pr.createdByEmail },
          label,
        })
      );
      commit({ status: "ready", round: opened, pr: null });
    } catch (error) {
      // A drift here (someone already opened a round) self-heals; anything
      // else belongs next to the compose form's own primary action.
      const message = await routeFailure(error);
      if (message !== null) {
        setOpenError(message);
      }
    } finally {
      setOpening(false);
      mutatingRef.current = false;
    }
  }

  const viewerAdoId = sdk.getUser().id;

  // The state-specific body. The refresh banner is deliberately outside
  // it: drift can be raised over any settled view, and the layout spec
  // puts the banner last (row 8), below whatever the viewer is reading.
  function renderBody(): React.ReactElement {
    if (state.status === "loading") {
      return <LoadingState />;
    }
    if (state.status === "error") {
      return <ErrorState />;
    }

    const { round, pr } = state;
    const role = deriveRole(viewerAdoId, round, pr?.createdByAdoId ?? null);
    const roundIsOpen = round !== null && round.status === "open";

    if (role === "author" && !roundIsOpen && pr !== null) {
      // No round open: the author composes the next one, which replaces the
      // read-only view of a terminal round.
      return (
        <ComposeForm
          nextRoundNumber={round === null ? 1 : round.roundNumber + 1}
          defaultPhase={round?.phase ?? "spec"}
          canOpen={hasEligibleReviewers(pr.reviewers, pr.createdByAdoId)}
          submitting={opening}
          openError={openError}
          onOpenRound={(phase, label) => {
            void handleOpenRound(phase, label);
          }}
        />
      );
    }

    if (round === null) {
      // No round (204) and no compose form: the bystander empty state.
      return (
        <EmptyState
          primaryText="No round yet"
          secondaryText="The author hasn't opened a review round on this PR."
        />
      );
    }

    if (round.reviewers.length === 0) {
      return (
        <EmptyState
          primaryText="No reviewers"
          secondaryText="This round has no tracked reviewers."
        />
      );
    }

    return (
      <RoundView
        round={round}
        viewerAdoId={viewerAdoId}
        onToggleOwn={() => {
          void handleToggleOwn();
        }}
        onEditLabel={(label) => {
          void handleEditLabel(label);
        }}
        onCancelRound={() => {
          void handleCancelRound();
        }}
        mutationError={mutationError}
      />
    );
  }

  return (
    <React.Fragment>
      {renderBody()}
      {drifted && (
        <RefreshBanner
          onRefresh={() => {
            void refresh();
          }}
        />
      )}
    </React.Fragment>
  );
}
