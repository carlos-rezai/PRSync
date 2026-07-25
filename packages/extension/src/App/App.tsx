import * as React from "react";
import { buildPrKey, deriveRole, mapApiError } from "../lib";
import type { Round } from "../lib";
import type { SdkClient } from "../sdk";
import type { ApiClient } from "../api";
import { ApiError } from "../api";
import type { AdoClient } from "../ado";
import {
  ComposePlaceholder,
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

interface AppProps {
  sdk: SdkClient;
  api: ApiClient;
  ado: AdoClient;
}

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; round: Round | null; createdByAdoId: string | null };

export function App({ sdk, api, ado }: AppProps): React.ReactElement {
  const [state, setState] = React.useState<LoadState>({ status: "loading" });
  const [toggleError, setToggleError] = React.useState<string | null>(null);

  // Reads the current round and resolves the ready state — the single ADO
  // `createdBy` read only happens on a 204. Shared by the initial load and
  // the drift-heal re-fetch.
  const resolveReadyState = React.useCallback(async (): Promise<LoadState> => {
    const parts = sdk.prKeyParts();
    const round = await api.getCurrentRound(buildPrKey(parts));
    if (round === null) {
      const pr = await ado.getPullRequest(parts);
      return {
        status: "ready",
        round: null,
        createdByAdoId: pr.createdByAdoId,
      };
    }
    return { status: "ready", round, createdByAdoId: null };
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
    const currentCreatedBy = state.createdByAdoId;
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
      createdByAdoId: currentCreatedBy,
    });

    try {
      const updated = await api.toggleDone(
        currentRound.prKey,
        currentRound.roundNumber,
        nextDone
      );
      // Reconcile: the returned round is authoritative — a `closed` round
      // surfaces the auto-close and freezes the list.
      setState({ status: "ready", round: updated, createdByAdoId: null });
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
        createdByAdoId: currentCreatedBy,
      });
      setToggleError(guidance.message);
    }
  }

  if (state.status === "loading") {
    return <LoadingState />;
  }
  if (state.status === "error") {
    return <ErrorState />;
  }

  const { round, createdByAdoId } = state;
  const viewerAdoId = sdk.getUser().id;
  const role = deriveRole(viewerAdoId, round, createdByAdoId);

  if (round === null) {
    // No round (204): author composes; everyone else sees the empty state.
    return role === "author" ? (
      <ComposePlaceholder />
    ) : (
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
