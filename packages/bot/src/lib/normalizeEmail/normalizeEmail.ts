// One person's address reaches PRSync from several directions — ADO's
// `uniqueName`, Teams' `userPrincipalName`, and eventually a hand-typed
// override — and they disagree about case and padding. The normalized
// form is the row key of the TeamsIdentities table, so two spellings
// that do not normalize alike are two rows: the person installs the app
// and then never gets a DM, with nothing anywhere reporting a fault.

/**
 * The canonical form of an email address: trimmed and lowercased.
 * Idempotent — it runs on the way in at capture and again at resolve,
 * and a second pass that changed anything would be a lookup miss.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
