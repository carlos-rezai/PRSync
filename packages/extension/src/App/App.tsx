import * as React from "react";
import { deriveRole, hasEligibleReviewers } from "../lib";
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

// The panel container: derive the viewer, choose the body, pass props.
//
// Everything about WHEN the panel reads, what it applies and what it does
// with a failure lives in `usePanelState` (the `hooks/` layer); everything
// about how a control looks and what it calls up lives in `components/`.
// What is left here is the choice between the four bodies, which is the
// one decision that needs both a round and a viewer to make.
//
// Dependency injection is the testing seam — tests pass fakes, boot passes
// the real host-backed clients (see index.tsx). The container takes all
// three clients only to hand them to the hook.
//
// The body is chosen in this order, and the order is the rule:
//   loading / error   → the panel has no round to talk about yet
//   author, no round  → the compose form REPLACES the read-only view
//   no round at all   → the bystander empty state
//   no reviewers      → the other empty state
//   otherwise         → the round itself
//
// The refresh banner sits deliberately OUTSIDE that choice: drift can be
// raised over any settled view, and the layout spec puts the banner last
// (row 8), below whatever the viewer is reading.
//
// Terminology: docs/ubiquitous-language.md.

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
    toggleOwn,
    editLabel,
    cancelRound,
    openRound,
  } = usePanelState({ sdk, api, ado });

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
            void openRound(phase, label);
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
          void toggleOwn();
        }}
        onEditLabel={(label) => {
          void editLabel(label);
        }}
        onCancelRound={() => {
          void cancelRound();
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
