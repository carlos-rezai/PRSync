import * as React from "react";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";

// The failed-load state: an error `MessageCard` when the initial
// getCurrentRound rejects.
//
// Deliberately one fixed message, unlike a failed MUTATION — which routes
// through `mapApiError` and gets a recovery specific to what went wrong.
// A failed load has no round to reconcile against and no control to sit
// next to, so the only thing it can honestly say is the thing that is
// always true and always actionable: reload the page.
export function ErrorState(): React.ReactElement {
  return (
    <MessageCard severity={MessageCardSeverity.Error}>
      Couldn&apos;t load the current round. Refresh the page to try again.
    </MessageCard>
  );
}
