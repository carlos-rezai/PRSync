import * as React from "react";
import { buildPrKey, deriveRole } from "../lib";
import type { Round } from "../lib";
import type { SdkClient } from "../sdk";
import type { ApiClient } from "../api";
import type { AdoClient } from "../ado";
import {
  ComposePlaceholder,
  EmptyState,
  ErrorState,
  LoadingState,
  RoundView,
} from "../components";

// The panel container. It owns the Phase 1 load state machine and wires
// the three injected clients (`sdk` / `api` / `ado`) into the read-only
// views. Dependency injection is the testing seam — tests pass fakes;
// boot passes the real host-backed clients (see index.tsx).
//
// Load sequence (PRD #7 "Load sequence"):
//   getCurrentRound → 200 → derive the whole view from the round; NO ADO
//                           call.
//                   → 204 → one ADO `createdBy` read decides author
//                           (compose placeholder) vs. bystander (ZeroData).

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

  React.useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const parts = sdk.prKeyParts();
        const round = await api.getCurrentRound(buildPrKey(parts));
        if (cancelled) {
          return;
        }
        if (round === null) {
          // 204 — the single ADO read that decides author vs. bystander.
          const pr = await ado.getPullRequest(parts);
          if (cancelled) {
            return;
          }
          setState({
            status: "ready",
            round: null,
            createdByAdoId: pr.createdByAdoId,
          });
          return;
        }
        // 200 — the round is self-sufficient; ADO is never read.
        setState({ status: "ready", round, createdByAdoId: null });
      } catch {
        if (!cancelled) {
          setState({ status: "error" });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [sdk, api, ado]);

  if (state.status === "loading") {
    return <LoadingState />;
  }
  if (state.status === "error") {
    return <ErrorState />;
  }

  const { round, createdByAdoId } = state;
  const role = deriveRole(sdk.getUser().id, round, createdByAdoId);

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

  return <RoundView round={round} />;
}
