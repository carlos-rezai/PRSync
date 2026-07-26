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

  /**
   * The skeleton all four mutations share. Each of them clears its error
   * slot, marks a mutation of the viewer's own in flight so a poll cannot
   * land on top of it, applies whatever the call resolved to as
   * authoritative state, routes a failure through `mapApiError`, and
   * lowers the flag whatever happened. Only the middle differs.
   *
   * `revert` is called only when the failure is one the viewer is told
   * about: a drift-class failure has already re-fetched the true state, so
   * undoing an optimistic write on top of it would put the stale round
   * back on screen.
   */
  async function runMutation({
    setError,
    setBusy,
    optimistic,
    revert,
    perform,
  }: {
    /** Where this mutation's failure message goes. */
    setError: (message: string | null) => void;
    /** Raised for the duration, when a control needs to disable itself. */
    setBusy?: (busy: boolean) => void;
    /** Applied before the call, so the viewer sees the result immediately. */
    optimistic?: () => void;
    /** Undoes `optimistic` when the viewer is shown a failure. */
    revert?: () => void;
    /**
     * The mutation itself, resolving to the state to commit. It owns its
     * own retry boundary, because that boundary is a real difference
     * between the four rather than something shared: the round-open
     * retries the API call ALONE, never the ADO snapshot read before it,
     * so a retry can never re-snapshot a reviewer list that moved.
     */
    perform: () => Promise<LoadState>;
  }): Promise<void> {
    setError(null);
    optimistic?.();
    setBusy?.(true);
    mutatingRef.current = true;
    try {
      commit(await perform());
    } catch (error) {
      const message = await routeFailure(error);
      if (message !== null) {
        revert?.();
        setError(message);
      }
    } finally {
      setBusy?.(false);
      mutatingRef.current = false;
    }
  }

  /** The open round the viewer is acting on, or `null` if there is none. */
  function actionableRound(): {
    round: Round;
    pr: AdoPullRequest | null;
  } | null {
    if (state.status !== "ready" || state.round === null) {
      return null;
    }
    return { round: state.round, pr: state.pr };
  }

  // A reviewer signals Done on their OWN row. The flip is optimistic, and
  // the returned round REPLACES panel state — authoritative, so it
  // surfaces an auto-close the instant this toggle meets quorum.
  async function toggleOwn(): Promise<void> {
    const current = actionableRound();
    if (current === null) {
      return;
    }
    const { round, pr } = current;
    const viewerAdoId = sdk.getUser().id;
    const me = round.reviewers.find(
      (reviewer) => reviewer.adoId === viewerAdoId
    );
    if (me === undefined) {
      return;
    }
    const nextDone = !me.done;

    await runMutation({
      setError: setMutationError,
      optimistic: () =>
        setState({
          status: "ready",
          round: {
            ...round,
            reviewers: round.reviewers.map((reviewer) =>
              reviewer.adoId === viewerAdoId
                ? { ...reviewer, done: nextDone }
                : reviewer
            ),
          },
          pr,
        }),
      // The baseline still holds the pre-flip round, which is exactly what
      // goes back on screen.
      revert: () => setState({ status: "ready", round, pr }),
      perform: async () => ({
        status: "ready",
        round: await withSingleRetry(() =>
          api.toggleDone(round.prKey, round.roundNumber, nextDone)
        ),
        pr,
      }),
    });
  }

  // The author renames an open round. Their typed text is already on
  // screen, so there is nothing optimistic to revert — only the returned
  // round to apply, which lets the API's stored wording win.
  async function editLabel(label: string): Promise<void> {
    const current = actionableRound();
    if (current === null) {
      return;
    }
    const { round, pr } = current;

    await runMutation({
      setError: setMutationError,
      perform: async () => ({
        status: "ready",
        round: await withSingleRetry(() =>
          api.editLabel(round.prKey, round.roundNumber, label)
        ),
        pr,
      }),
    });
  }

  // The author abandons an open round. The result is terminal, so settling
  // reads ADO's live PR and lands the author straight on the compose form
  // for round N+1.
  async function cancelRound(): Promise<void> {
    const current = actionableRound();
    if (current === null) {
      return;
    }
    const { round } = current;

    await runMutation({
      setError: setMutationError,
      perform: async () =>
        settle(
          await withSingleRetry(() =>
            api.cancelRound(round.prKey, round.roundNumber)
          )
        ),
    });
  }

  // The author opens the next round. The authoritative reviewer snapshot
  // is read HERE, at the click — never reused from the load-time read that
  // only gated the button. It has its own error slot because its failure
  // belongs beside the compose form's primary action, not beside a round.
  async function openRound(
    phase: Phase,
    label: string | undefined
  ): Promise<void> {
    const parts = sdk.prKeyParts();

    await runMutation({
      setError: setOpenError,
      setBusy: setOpening,
      perform: async () => {
        const pr = await ado.getPullRequest(parts);
        return {
          status: "ready",
          round: await withSingleRetry(() =>
            api.openRound(buildPrKey(parts), {
              phase,
              reviewers: pr.reviewers,
              prTitle: pr.title,
              prUrl: pr.url,
              author: { name: pr.createdByName, email: pr.createdByEmail },
              label,
            })
          ),
          pr: null,
        };
      },
    });
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
