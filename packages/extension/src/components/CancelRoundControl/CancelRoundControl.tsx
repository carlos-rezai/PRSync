import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { Dialog } from "azure-devops-ui/Dialog";

// Panel row 7 (docs/handoff/panel-layout-spec.md): the author's Cancel
// round control, shown only while the round is `open`.
//
// Cancelling is a SILENT abandonment — the round goes terminal and, unlike
// a real close, no Teams DM goes out — so it is never one misclick away.
// The button only opens the confirmation `Dialog`; dismissing it changes
// nothing, and only confirming calls up to the `App`. The confirmation's
// open/closed state is presentation, so it lives here; the mutation and
// its error recovery belong to the `App`.

export function CancelRoundControl({
  onCancelRound,
}: {
  onCancelRound: () => void;
}): React.ReactElement {
  const [confirming, setConfirming] = React.useState(false);

  return (
    <React.Fragment>
      <Button
        className="prsync-cancel-button"
        text="Cancel round"
        danger={true}
        onClick={() => setConfirming(true)}
      />
      {confirming && (
        <Dialog
          titleProps={{ text: "Cancel round?" }}
          onDismiss={() => setConfirming(false)}
          footerButtonProps={[
            { text: "Keep round", onClick: () => setConfirming(false) },
            {
              text: "Cancel round",
              danger: true,
              onClick: () => {
                setConfirming(false);
                onCancelRound();
              },
            },
          ]}
        >
          This round is abandoned and its reviewers are not notified. You can
          open a new round straight afterwards.
        </Dialog>
      )}
    </React.Fragment>
  );
}
