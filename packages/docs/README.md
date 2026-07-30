# @prsync/docs

The workspace whose subject is PRSync's documentation.

Every other package here has a runtime. This one does not: it is private,
has no `main` and no `build` script, so `npm run build --workspaces
--if-present` skips it and no deploy target can ever include it. Its
"product" is the repo's prose, and its job is to make claims about that
prose mechanically checkable — that every link resolves, that a glossed
term still exists upstream, that no user-facing surface describes a close
rule PRSync does not have.

It is a workspace rather than a directory of tests because the
documentation is a subject in its own right. These checks lived in
`packages/bot/src/test/` until issue #32, where they read `README.md`,
both guides, the ubiquitous language and the extension's Marketplace
manifest — so renaming a heading in the panel's listing turned the
**bot's** suite red. That was build order fossilised into structure, for
the third time in this repo.

## Layers

Same conventions as the other three packages: folder per module with a
co-located test, exactly one barrel `index.ts` per layer as its public
API, cross-layer imports through the target layer's barrel, within-layer
imports by direct file path.

| Layer     | Purpose                                                                                              | Rule                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `lib/`    | Pure text over markdown: `fences`, `section`, `githubSlug`, `boldedTerms`, `settingTokens`, `stages` | The LEAF layer — imports no other layer, touches no filesystem, every function has a test |
| `repo/`   | The filesystem seam: the `Repo` port, `repoAt`, `readDocument`, `sourceFiles`                        | The ONLY layer that performs I/O                                                          |
| `checks/` | The analyses: `unresolvedLinks`, `surfaceText`, `unanimityAliases`                                   | Each takes a `Repo` and RETURNS findings; none asserts                                    |

The `Repo` port is why any of this is testable. The failures these checks
guard against — a missing file, an anchor matching no heading, a sentence
describing the wrong close rule — are exactly what a **correct**
repository cannot demonstrate, so every check is driven against an
in-memory fake. Same trick `packages/api`'s `QueueProducer` and
`packages/bot`'s `TeamsSender` play on their vendor clients.

## Two kinds of test, separated by directory

- **Module tests** (`src/lib/*/`, `src/repo/*/`, `src/checks/*/`) drive
  one function against `fakeRepo` or a string literal. They can
  demonstrate failure, and they are where a bug in the library is caught.
- **Repo assertions** (`src/test/*.test.ts`) point the checks at _this_
  repository and expect no findings. They cannot demonstrate failure — a
  correct repo has nothing to report — which is why each is paired with a
  floor: something was actually scanned, a link was actually found in
  every document, every surface yielded text.

`src/test/fixtures/` sits outside the layer conventions for the same
reason every fixtures directory in this repo does: every layer's tests
consume it, so putting it inside any one module would force imports
upward and across layers.

## Note on `readSourceFiles`

`repo/sourceFiles/` is a **second copy**;
`packages/bot/src/test/fixtures/sourceFiles.ts` is the other, and it stays
there because `layerPolicy.test.ts` still needs a walker over the bot's own
source. Sharing one means a workspace-to-workspace dependency, which this
repo has declined twice before — for `NotificationMessage` and for
`statusCodeOf`. Recorded as an accepted cost in
[`docs/deployment.md`](../../docs/deployment.md).
