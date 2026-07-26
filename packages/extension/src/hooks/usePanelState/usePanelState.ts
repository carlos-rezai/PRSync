import * as React from "react";
import {
  buildPrKey,
  mapApiError,
  roundFingerprint,
  withSingleRetry,
  ApiError,
} from "../../lib";
import type { Phase, Round } from "../../lib";
import type { SdkClient } from "../../sdk";
import type { ApiClient } from "../../api";
import type { AdoClient, AdoPullRequest } from "../../ado";

// The panel's state machine, lifted out of the container so that `App` is
// left with rendering. Everything about WHEN the panel reads, what it
// applies, and what it does with a failure lives here; everything about
// what the viewer sees lives in `App` and `components/`.
//
// Load sequence (PRD #7 "Load sequence"):
//   getCurrentRound → 200 → derive the whole view from the round; NO ADO
//                           call.
//                   → 204 → one ADO `createdBy` read decides author
//                           (compose placeholder) vs. bystander (ZeroData).
//
// Polling + drift (PRD #7 "Polling" / "Drift detection"): review is live
// team activity, so a ~20s poll re-reads the current round and compares a
// `roundFingerprint` against the viewer's BASELINE — the last
// authoritative state they saw or acted on (`commit`). A divergence is
// someone ELSE's change: it raises the refresh banner and nothing more,
// because the panel never live-patches state under a cursor. Clicking the
// banner is the only path that updates a drifted panel. The viewer's own
// mutations commit their result, which resets the baseline, so they can
// never raise the banner at themselves.

export type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; round: Round | null; pr: AdoPullRequest | null };

/** Poll cadence, within the layout spec's 15–30s window. */
const POLL_INTERVAL_MS = 20_000;

export function usePanelState({
  sdk,
  api,
  ado,
}: {
  sdk: SdkClient;
  api: ApiClient;
  ado: AdoClient;
}) {
  const [state, setState] = React.useState<LoadState>({ status: "loading" });
  // One inline slot for every round mutation (toggle / label / cancel) —
  // they share the same failure contract and the same place on screen.
  const [mutationError, setMutationError] = React.useState<string | null>(null);
  const [openError, setOpenError] = React.useState<string | null>(null);
  const [opening, setOpening] = React.useState(false);
  // Raised by a poll that found someone else's change; lowered only by an
  // authoritative state landing (`commit`).
  const [drifted, setDrifted] = React.useState(false);

  // The digest of the last authoritative state the viewer saw — what a
  // poll compares against. `null` means the panel never settled, which
  // also suspends polling (there is nothing to drift from, and a viewer
  // staring at the load error is told to refresh the page instead).
  const baselineRef = React.useRef<string | null>(null);
  // True while a mutation of the VIEWER'S OWN is in flight, so a poll can
  // never land on top of their optimistic update.
  const mutatingRef = React.useRef(false);

  // The single path for applying authoritative state. What the viewer now
  // sees is by definition what they have seen, so it is also the new drift
  // baseline — and it answers any banner already raised.
  const commit = React.useCallback((next: LoadState): void => {
    baselineRef.current =
      next.status === "ready" ? roundFingerprint(next.round) : null;
    setDrifted(false);
    setState(next);
  }, []);

  // Settles the ready state around a round, reading ADO's live PR only
  // when a compose form may follow: no round at all (the read also decides
  // author vs. bystander), or a terminal round the author could follow
  // with the next one. An open round is self-sufficient.
  const settle = React.useCallback(
    async (round: Round | null): Promise<LoadState> => {
      const mayCompose =
        round === null ||
        (round.status !== "open" && sdk.getUser().id === round.authorAdoId);
      const pr = mayCompose ? await ado.getPullRequest(sdk.prKeyParts()) : null;
      return { status: "ready", round, pr };
    },
    [sdk, ado]
  );

  // Reads the current round and settles around it — shared by the initial
  // load and the drift-heal re-fetch.
  const resolveReadyState = React.useCallback(async (): Promise<LoadState> => {
    return settle(await api.getCurrentRound(buildPrKey(sdk.prKeyParts())));
  }, [sdk, api, settle]);

  // Routes a mutation failure. A drift-class 409/403 re-fetches the true
  // state and self-heals in place, returning `null` (nothing left to
  // show); anything else returns the message to surface inline.
  const routeFailure = React.useCallback(
    async (error: unknown): Promise<string | null> => {
      const guidance =
        error instanceof ApiError
          ? mapApiError(error.status, error.code)
          : mapApiError(500, null);

      if (guidance.recovery !== "refetch") {
        return guidance.message;
      }
      try {
        commit(await resolveReadyState());
      } catch {
        commit({ status: "error" });
      }
      return null;
    },
    [resolveReadyState, commit]
  );

  React.useEffect(() => {
    let cancelled = false;
    resolveReadyState()
      .then((next) => {
        if (!cancelled) {
          commit(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          commit({ status: "error" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [resolveReadyState, commit]);

  // One poll: read the current round and compare it to the baseline. The
  // polled round is deliberately DISCARDED — a divergence only raises the
  // banner, and the click re-reads the true state for itself.
  const poll = React.useCallback(async (): Promise<void> => {
    // Skipped rather than rescheduled: `document.hidden` (Page Visibility)
    // means a backgrounded panel spends nothing, an in-flight mutation of
    // the viewer's owns the state until it reconciles, and an unsettled
    // panel has no baseline to compare against.
    if (
      document.hidden ||
      mutatingRef.current ||
      baselineRef.current === null
    ) {
      return;
    }
    try {
      const polled = await api.getCurrentRound(buildPrKey(sdk.prKeyParts()));
      if (roundFingerprint(polled) !== baselineRef.current) {
        setDrifted(true);
      }
    } catch {
      // A failed poll is silent: what the viewer is reading is still valid,
      // and the next tick tries again.
    }
  }, [sdk, api]);

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [poll]);

  // Autosize: the panel lives in an iframe the HOST sizes, and nothing it
  // draws changes that height on its own. Every render here IS a content
  // change — the panel only re-renders when its state moves (a round
  // settles, a mutation swaps the view, the refresh banner appears) — so
  // asking the host to re-measure after each one is both the complete
  // answer and the only one that needs no guess at what the new height
  // should be. Deliberately dependency-free: a list of "things that affect
  // height" is a list that silently goes stale.
  React.useEffect(() => {
    sdk.resize();
  });

  async function toggleOwn(): Promise<void> {
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

  async function editLabel(label: string): Promise<void> {
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

  async function cancelRound(): Promise<void> {
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

  async function openRound(
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

  // The banner's action — the only path that updates a drifted panel.
  async function refresh(): Promise<void> {
    try {
      commit(await resolveReadyState());
    } catch {
      commit({ status: "error" });
    }
  }

  // The panel's state, and the five things a viewer can do to it. No
  // setters, no refs, no internal callbacks: what leaves this hook is what
  // `App` renders and what it wires to a control.
  return {
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
  };
}
