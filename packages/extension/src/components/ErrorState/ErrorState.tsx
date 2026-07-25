import * as React from "react";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";

// The failed-load state: an error `MessageCard` when the initial
// getCurrentRound rejects. The richer, code-aware recovery messages
// (mapApiError) arrive in Phase 5; Phase 1 shows a single retry prompt.
export function ErrorState(): React.ReactElement {
  return (
    <MessageCard severity={MessageCardSeverity.Error}>
      Couldn&apos;t load the current round. Refresh the page to try again.
    </MessageCard>
  );
}
