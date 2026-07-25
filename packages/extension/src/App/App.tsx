import * as React from "react";
import {
  buildPrKey,
  deriveRole,
  hasEligibleReviewers,
  mapApiError,
} from "../lib";
import type { Phase, Round } from "../lib";
import type { SdkClient } from "../sdk";
import type { ApiClient } from "../api";
import { ApiError } from "../api";
import type { AdoClient, AdoPullRequest } from "../ado";
import {
  ComposeForm,
  EmptyState,
  ErrorState,
  LoadingState,
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

interface AppProps {
  sdk: SdkClient;
  api: ApiClient;
  ado: AdoClient;
}

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; round: Round | null; pr: AdoPullRequest | null };

export function App({ sdk, api, ado }: AppProps): React.ReactElement {
  const [state, setState] = React.useState<LoadState>({ status: "loading" });
  const [toggleError, setToggleError] = React.useState<string | null>(null);
  const [openError, setOpenError] = React.useState<string | null>(null);
  const [opening, setOpening] = React.useState(false);

  // Reads the current round and resolves the ready state. ADO's live PR is
  // read only when a compose form may follow: no round at all (the read
  // also decides author vs. bystander), or a terminal round the author
  // could follow with the next one. An open round is self-sufficient.
  // Shared by the initial load and the drift-heal re-fetch.
  const resolveReadyState = React.useCallback(async (): Promise<LoadState> => {
    const parts = sdk.prKeyParts();
    const round = await api.getCurrentRound(buildPrKey(parts));
    const mayCompose =
      round === null ||
      (round.status !== "open" && sdk.getUser().id === round.authorAdoId);
    const pr = mayCompose ? await ado.getPullRequest(parts) : null;
    return { status: "ready", round, pr };
  }, [sdk, api, ado]);

  React.useEffect(() => {
    let cancelled = false;
    resolveReadyState()
      .then((next) => {
        if (!cancelled) {
          setState(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: "error" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [resolveReadyState]);

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
    setToggleError(null);
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

    try {
      const updated = await api.toggleDone(
        currentRound.prKey,
        currentRound.roundNumber,
        nextDone
      );
      // Reconcile: the returned round is authoritative — a `closed` round
      // surfaces the auto-close and freezes the list.
      setState({ status: "ready", round: updated, pr: currentPr });
    } catch (error) {
      const guidance =
        error instanceof ApiError
          ? mapApiError(error.status, error.code)
          : mapApiError(500, null);

      if (guidance.recovery === "refetch") {
        // Drift: re-read the true state and self-heal, no inline error.
        try {
          setState(await resolveReadyState());
        } catch {
          setState({ status: "error" });
        }
        return;
      }

      // Revert the optimistic flip and show the inline recovery message.
      setState({
        status: "ready",
        round: currentRound,
        pr: currentPr,
      });
      setToggleError(guidance.message);
    }
  }

  async function handleOpenRound(
    phase: Phase,
    label: string | undefined
  ): Promise<void> {
    const parts = sdk.prKeyParts();
    setOpenError(null);
    setOpening(true);
    try {
      // The authoritative snapshot is read HERE, at the click — never
      // reused from the load-time read that gated the button.
      const pr = await ado.getPullRequest(parts);
      const opened = await api.openRound(buildPrKey(parts), {
        phase,
        reviewers: pr.reviewers,
        prTitle: pr.title,
        prUrl: pr.url,
        author: { name: pr.createdByName, email: pr.createdByEmail },
        label,
      });
      setState({ status: "ready", round: opened, pr: null });
    } catch (error) {
      const guidance =
        error instanceof ApiError
          ? mapApiError(error.status, error.code)
          : mapApiError(500, null);

      if (guidance.recovery === "refetch") {
        // Drift (someone already opened a round): re-read and self-heal.
        try {
          setState(await resolveReadyState());
        } catch {
          setState({ status: "error" });
        }
        return;
      }

      setOpenError(guidance.message);
    } finally {
      setOpening(false);
    }
  }

  if (state.status === "loading") {
    return <LoadingState />;
  }
  if (state.status === "error") {
    return <ErrorState />;
  }

  const { round, pr } = state;
  const viewerAdoId = sdk.getUser().id;
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
      toggleError={toggleError}
    />
  );
}
