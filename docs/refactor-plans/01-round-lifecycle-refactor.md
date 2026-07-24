# 01 — Round Lifecycle: folder-per-module structure with per-layer barrels

> Initiative: `round-lifecycle` · Refactor plan for `packages/api/src`
> Issue: https://github.com/carlos-rezai/PRSync/issues/6

Purely structural refactor of `packages/api/src`. No behaviour, no
public HTTP contract, and no domain logic changes — only the on-disk
layout of the four layers (`lib/`, `storage/`, `services/`,
`functions/`) and the import paths between them. Every commit leaves
the codebase compiling (`npm run typecheck`) and its unit/behavioural
tests green.

## Problem Statement

`packages/api/src` keeps every module as a flat pair of sibling files
in its layer directory — `lib/closePredicate.ts` next to
`lib/closePredicate.test.ts`, `lib/label.ts` next to
`lib/label.test.ts`, and so on across all four layers. As the surface
grows, a layer directory becomes a long undifferentiated list where a
module and its test, its future fixtures, and any future co-located
helper are only related by a shared filename prefix, not by physical
grouping. There is also no single import entry point per layer:
consumers reach in at granular paths (`../lib/label`, `../lib/prKey`,
`../lib/closePredicate`, `../lib/types`), so the "public shape" of a
layer is implicit and every consumer hard-codes the internal file
layout of the layer it depends on.

The developer wants each module to live in its own dedicated folder
holding the module and everything that belongs to it, and each layer
to expose a single barrel `index.ts` that is the layer's public API —
so consumers depend on the layer, not on its internal file names — and
wants the convention documented so it stays consistent as the project
grows.

## Solution

Give every module its own folder named after the module, containing
the implementation file and its co-located test (keeping the existing
`X.ts` / `X.test.ts` names — the folder, not the file, is renamed).
Add one barrel `index.ts` per layer that re-exports every module in
that layer; the barrel is the layer's public API. Rewrite imports so
that:

- **Cross-layer** imports go through the target layer's barrel
  (`../../lib`, `../../storage`, `../../services`) — a consumer never
  names another layer's internal files.
- **Within-layer** imports between sibling modules use the sibling's
  direct path (`../types/types`, `../NotificationPort/NotificationPort`)
  rather than the layer's own barrel, so a module never imports the
  barrel that re-exports it (no import cycles).

The pattern is applied to all four layers. The shared `types` module
gets its own `types/` folder for uniformity even though it has no test.
The Azure Functions discovery glob is widened from non-recursive to
recursive so compiled handlers in subfolders are still found. The
convention is documented in `.claude/CLAUDE.md`.

End-state shape (illustrative for one layer):

```
lib/
  index.ts                     <- barrel: re-exports every module
  types/
    types.ts
  closePredicate/
    closePredicate.ts
    closePredicate.test.ts
  label/
    label.ts
    label.test.ts
  prKey/
    prKey.ts
    prKey.test.ts
  reviewerSnapshot/
    reviewerSnapshot.ts
    reviewerSnapshot.test.ts
  roundNumber/
    roundNumber.ts
    roundNumber.test.ts
```

Consumers import from the layer root:
`import { isCloseReached, generateLabel } from "../../lib";`

## Commits

Ordered leaf-first (`lib` → `storage` → `services` → `functions` →
docs) so that when a layer is folderized, the layers that depend on it
are still in place and only need their import path updated to the
layer's barrel. Each layer starts with a **barrel-scaffold** commit
that introduces the barrel over the still-flat files and repoints
consumers at it — isolating the "switch consumers to the barrel" change
from the physical file moves that follow, so consumers are touched at
most once per layer they depend on (plus once more only if the consumer
itself later moves and its own relative paths shift by one level).

Every commit message uses the project convention:
`refactor: [round-lifecycle] issue #6 <description>`.

### lib/ (leaf layer)

1. **Add the `lib` barrel and switch consumers to it.**
   Create `lib/index.ts` re-exporting the six current flat modules
   (`closePredicate`, `label`, `prKey`, `reviewerSnapshot`,
   `roundNumber`, `types`). Repoint every external importer of a `lib`
   file — in `storage/`, `services/`, and `functions/` (impl and test
   files) — from `../lib/<module>` to `../lib`. No files move yet.
   _Green: barrel re-exports the same symbols from the same files._

2. **Move `types` into `lib/types/types.ts`.**
   Update the barrel's `types` line to the new path. Update the still-
   flat siblings that import `./types` (`closePredicate.ts`,
   `label.ts`, `reviewerSnapshot.ts`) and the lib tests that import
   `./types` (`closePredicate.test.ts`, `reviewerSnapshot.test.ts`) to
   `./types/types`. `types` moved first so subsequent sibling moves
   reference it at its final location.

3. **Move `closePredicate` into `lib/closePredicate/`.**
   Impl + test move together. In the impl, `./types/types` becomes
   `../types/types`; the test's import of the impl stays `./closePredicate`
   and its `./types/types` becomes `../types/types`. Update the barrel
   line to `./closePredicate/closePredicate`.

4. **Move `label` into `lib/label/`.** Same mechanics as #3 (`label.ts`
   imports `types`; `label.test.ts` imports the impl only).

5. **Move `prKey` into `lib/prKey/`.** No `types` dependency; the test
   imports the impl only. Update the barrel line.

6. **Move `reviewerSnapshot` into `lib/reviewerSnapshot/`.** Same as #3.

7. **Move `roundNumber` into `lib/roundNumber/`, and delete
   `lib/.gitkeep`.** The test imports the impl only. Update the barrel
   line. `lib` is now fully folderized.

### storage/ (depends on lib)

8. **Add the `storage` barrel and switch consumers to it.**
   Create `storage/index.ts` re-exporting the flat `RoundRepository`
   module (`RoundRepository` interface, `TableStorageRoundRepository`,
   `PreconditionFailedError`). Repoint `services/RoundService.ts` and
   `services/RoundService.test.ts` from `../storage/RoundRepository` to
   `../storage`.

9. **Move `RoundRepository` into `storage/RoundRepository/`, and delete
   `storage/.gitkeep`.** Impl + test move together. In both, the `lib`
   barrel import `../lib` becomes `../../lib`; the test's import of the
   impl stays `./RoundRepository`. Update the barrel line to
   `./RoundRepository/RoundRepository`.

### services/ (depends on lib + storage)

10. **Add the `services` barrel and switch consumers to it.**
    Create `services/index.ts` re-exporting `RoundService` (class,
    `RoundServiceError`, its input/error types), `NotificationPort`
    (interface + `NoopNotificationPort`), and `IdentityResolver`
    (interface + `ResolvedIdentity`). Repoint the `functions/` handlers
    and tests from `../services/RoundService` and
    `../services/IdentityResolver` to `../services`.

11. **Move `NotificationPort` into `services/NotificationPort/`.**
    In the impl, `../lib` becomes `../../lib`. Update the still-flat
    `RoundService.ts` and `RoundService.test.ts` sibling import from
    `./NotificationPort` to `./NotificationPort/NotificationPort`.
    Update the barrel line. (No test file for this module.)

12. **Move `IdentityResolver` into `services/IdentityResolver/`.**
    Only imports `@azure/functions` (unchanged). Update the barrel line.
    (No test file; no within-layer sibling imports it — `functions/`
    already reaches it through the `services` barrel.)

13. **Move `RoundService` into `services/RoundService/`, and delete
    `services/.gitkeep`.** Impl + test move together. Rewrite for the
    extra depth: `../lib` → `../../lib`, `../storage` → `../../storage`,
    and the `NotificationPort` sibling import to
    `../NotificationPort/NotificationPort`; the test's import of the
    impl stays `./RoundService`. Update the barrel line to
    `./RoundService/RoundService`.

### functions/ (depends on lib + services)

14. **Add the `functions` barrel and widen the discovery glob.**
    Create `functions/index.ts` re-exporting the five handler factories
    (`makeOpenRoundHandler`, `makeToggleDoneHandler`,
    `makeEditLabelHandler`, `makeCancelRoundHandler`,
    `makeGetCurrentRoundHandler`). Change `packages/api/package.json`
    `main` from `dist/src/functions/*.js` to
    `dist/src/functions/**/*.js` so compiled handlers in subfolders are
    still discovered. No handler moves yet (`**` also matches the
    current flat files), so this stays green.

15. **Move `openRound` into `functions/openRound/`.** Impl + test move
    together. In both, `../lib` → `../../lib` and `../services` →
    `../../services`; the test's import of the impl stays `./openRound`.
    Update the barrel line.

16. **Move `toggleDone` into `functions/toggleDone/`.** Same mechanics.

17. **Move `editLabel` into `functions/editLabel/`.** Same mechanics.

18. **Move `cancelRound` into `functions/cancelRound/`.** Same mechanics.

19. **Move `getCurrentRound` into `functions/getCurrentRound/`, and
    delete `functions/.gitkeep`.** Same mechanics. `functions` is now
    fully folderized.

### docs

20. **Document the convention in `.claude/CLAUDE.md`.** Update the
    "Monorepo Structure" tree and the "Layer Responsibilities" section
    to state the folder-per-module layout, the one-barrel-`index.ts`-
    per-layer rule, and the import convention (cross-layer via the
    target layer's barrel; within-layer via the sibling's direct path).

## Decision Document

- **Scope:** all four layers under `packages/api/src` — `lib/`,
  `storage/`, `services/`, `functions/`.
- **Module folder:** each module gets a folder named after the module,
  holding the implementation file and its co-located test under their
  existing names (`X.ts`, `X.test.ts`). The folder is what carries the
  module name; the files keep their names. No file is renamed to
  `index.ts`.
- **Barrel per layer:** exactly one `index.ts` per layer directory,
  re-exporting every module in that layer. This barrel is the layer's
  public API. There are **no** per-module `index.ts` barrels.
- **Import convention (two rules):**
  - Cross-layer imports resolve through the target layer's barrel
    (`../../lib`, `../../storage`, `../../services`).
  - Within-layer imports between sibling modules use the sibling's
    direct file path (e.g. `../types/types`), never the layer's own
    barrel — a module must not import the barrel that re-exports it, to
    avoid import cycles.
- **`types` module:** moves into its own `lib/types/types.ts` folder for
  uniformity, despite having no test. It is the one shared leaf all
  other `lib` modules depend on, so it moves first within `lib`.
- **Module resolution:** the api package uses `moduleResolution: "Node"`
  (overriding the base `Bundler`), which resolves a folder import to its
  `index.ts` / compiled `index.js` — barrels work in both source and
  build.
- **Azure Functions discovery:** `packages/api/package.json` `main`
  changes from `dist/src/functions/*.js` to `dist/src/functions/**/*.js`
  because folderizing handlers moves compiled output one level deeper.
  (Function registration wiring itself is untouched — `src/index.ts`
  stays as-is; see Out of Scope.)
- **`.gitkeep` files:** the per-layer `.gitkeep` placeholders are
  removed as each layer is fully folderized (folded into that layer's
  final move commit).
- **Ordering:** leaf-first (`lib` → `storage` → `services` →
  `functions`), each layer beginning with a barrel-scaffold + consumer-
  switch commit, then one commit per module move, so every commit
  compiles and its tests pass.
- **No behaviour change:** no public HTTP route, status code, request/
  response shape, domain rule, storage schema, or exported symbol name
  changes. Only file locations and the import paths between them.

## Testing Decisions

- **A good test here asserts external behaviour, not file layout.** The
  existing suite already does this — `lib` helpers are unit-tested
  through their public functions, `RoundService` is tested behaviourally
  against an in-memory `RoundRepository` fake and a spy
  `NotificationPort`, and `RoundRepository` is integration-tested
  against Azurite. None of these assert on import paths or file
  locations, so a structural move must not require rewriting any test's
  assertions — only its import lines move with it.
- **No new tests are written.** This is a move-only refactor; the
  safety net is the pre-existing suite plus the compiler. Adding tests
  would be out of character for a structural change and outside its
  scope.
- **Per-commit verification:** run `npm run typecheck --workspace
@prsync/api` (fast, no infrastructure) and `npm run test --workspace
@prsync/api` after each commit. Typecheck is the primary guard — it
  catches every broken or dangling import a move could introduce.
  Vitest uses default discovery (no config file), so moved `*.test.ts`
  files are still found automatically.
- **Azurite note:** `RoundRepository.test.ts` is an integration test
  that requires the Azurite emulator running (`npx azurite`). When the
  emulator is not available that single suite is expected to be skipped/
  failing for environmental reasons unrelated to the refactor; the move
  in commit #9 is still verified by typecheck and by the rest of the
  suite. Confirm the same suite passes with the emulator running once
  before and once after commit #9.
- **Prior art:** the existing co-located Vitest tests
  (`RoundService.test.ts`, `closePredicate.test.ts`, etc.) are the
  pattern; they remain co-located, now one level deeper inside their
  module folder.

## Out of Scope

- **Function registration wiring.** `src/index.ts` is currently empty —
  no `app.http(...)` calls register the handler factories. Wiring the
  handlers into routes (and any CORS lockdown that belongs with it) is a
  separate concern and is not part of this structural refactor. The
  `main` glob is widened only so that discovery keeps working once
  wiring lands.
- **The duplication across the four mutating handlers** (repeated prKey/
  round-number validation, body-size guard, JSON-parse, identity
  resolve, and the three near-identical `statusForError` functions plus
  `openRound`'s inline mapping). Consolidating these is a real
  refactor, but a behavioural/DRY one — deliberately kept out so this
  change stays a pure file-move.
- **`RoundService.toggleDone` control-flow tidy** (the doubled
  "not a reviewer" check). Behavioural; not part of a move-only pass.
- **Any change to domain logic, the storage schema, the HTTP contract,
  or exported symbol names.**
- **Other packages** (`extension`, `bot`) and the repo root — untouched.
- **Introducing a README** — the convention is documented in
  `.claude/CLAUDE.md` only (no README exists in the repo).

## Further Notes

- The double-touch on some import lines (a sibling's `types` import
  changes once when the sibling moves and once when `types` moves) is
  inherent to moving files that reference each other and is purely
  mechanical; the leaf-first order and moving `types` first within
  `lib` keep it to a minimum.
- After this refactor, adding a new module means adding a folder and one
  line to that layer's barrel — the layer's public surface stays
  explicit in one place.
