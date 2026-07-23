# Dev Journal

Running log of notable decisions, dead ends, and context for future
sessions. Newest entries at the top.

---

## 2026-07-23 — Project scaffolded

Repo structure set up as an npm-workspaces monorepo with three
packages (`extension`, `api`, `bot`), following the same
`docs/`-as-paper-trail convention as Horizon. Initial grill-me session
completed covering the full round/phase/reviewer data model and the
v1 scope (ADO extension panel + Teams DM via incoming webhook, no bot
yet). See docs/ubiquitous-language.md for terms established.

`packages/bot` is a placeholder only — deferred to v2, see CLAUDE.md
Build Status.
