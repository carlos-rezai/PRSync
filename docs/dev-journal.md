# Dev Journal

Running log of notable decisions, dead ends, and context for future
sessions. Newest entries at the top.

---

## 2026-07-24 — Round-lifecycle folder-per-module refactor (issue #6)

Executed the 20-commit structural refactor in
`docs/refactor-plans/01-round-lifecycle-refactor.md`: every module in
`packages/api/src` now lives in its own folder with a co-located test,
and each of the four layers exposes a single barrel `index.ts` as its
public API. No behaviour changed; the full suite stayed green (125
tests) after every commit.

Discovered during commit 20: `.claude/` is gitignored
(`.gitignore:32`), so `.claude/CLAUDE.md` — where the plan says to
document the new convention — is untracked and cannot be committed
normally. The documentation edit was still applied on disk (future
Claude sessions read the on-disk file, so the convention IS
documented), but it lives outside version control unless force-added
(`git add -f`). Left for the author to decide, since force-adding
overrides a deliberate `.gitignore` choice. Commit 20 therefore has no
git commit of its own; commits 1–19 landed as planned.

## 2026-07-23 — Project scaffolded

Repo structure set up as an npm-workspaces monorepo with three
packages (`extension`, `api`, `bot`), following the same
`docs/`-as-paper-trail convention as Horizon. Initial grill-me session
completed covering the full round/phase/reviewer data model and the
v1 scope (ADO extension panel + Teams DM via incoming webhook, no bot
yet). See docs/ubiquitous-language.md for terms established.

`packages/bot` is a placeholder only — deferred to v2, see CLAUDE.md
Build Status.
