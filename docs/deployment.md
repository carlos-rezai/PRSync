# Deployment

What has to be true before PRSync works in a real Azure DevOps
organization. Read the prerequisites first — every one of them fails
_silently_ from the panel's point of view if it is skipped.

Scope: the API (`packages/api`) and the extension panel
(`packages/extension`). The Teams bot (`packages/bot`) arrives with
Feature 3 and will be documented alongside it.

---

## Prerequisite: Function App CORS must allow the ADO org origin

**This is the one that will bite you.** The panel runs inside an iframe
on an Azure DevOps origin and calls the Function App on a _different_
origin, so every request it makes — including the initial
`GET /api/prs/{prKey}/rounds/current` — is a cross-origin request.

A Function App that has not allowed the calling origin fails all of them
at the browser, before the request is ever sent. The extension installs,
the tab appears, the panel renders — and then nothing works, with
**nothing in the Function App's own logs** to explain it, because the API
was never reached. The only evidence is a CORS error in the browser
console.

So CORS is a deploy prerequisite, not a troubleshooting note.

### Allowed origins to configure

Add the origins the panel is served to and from:

- `https://dev.azure.com` — the ADO org's own origin (the host page).
- `https://<publisher>.gallerycdn.vsassets.io` — where ADO serves the
  extension's iframe content from, using the publisher id from
  `vss-extension.json`.

Confirm the exact value for your install rather than trusting this list:
open the PRSync tab on a PR, open the browser devtools Network tab, and
read the `Origin` request header on the failing call. That string,
verbatim, is what the Function App must allow.

Note that CORS is a _browser_ control, not authentication. Every PRSync
endpoint independently requires a valid ADO bearer token and resolves the
caller's identity before touching storage — locking CORS down narrows the
attack surface, it does not create the auth boundary.

### Configuring it

Portal: **Function App → API → CORS** → add each allowed origin →
**Save**. Leave _"Enable Access-Control-Allow-Credentials"_ off; the
panel authenticates with a bearer header, not cookies.

CLI:

```bash
az functionapp cors add \
  --name <function-app-name> \
  --resource-group <resource-group> \
  --allowed-origins https://dev.azure.com https://<publisher>.gallerycdn.vsassets.io
```

Do **not** add `*`. A wildcard allows any site a signed-in user visits to
call the API with the user's own token flow, and Azure ignores a wildcard
entirely when credentials are enabled.

---

## Prerequisite: API configuration

`packages/api` reads its storage connection from the environment:

| Setting                          | Value                                |
| -------------------------------- | ------------------------------------ |
| `AZURE_TABLES_CONNECTION_STRING` | The Table Storage connection string. |

Set it as a Function App application setting (locally, in
`local.settings.json`, which is git-ignored).

---

## Prerequisite: panel configuration

`packages/extension` is a _static_ bundle — its configuration is baked in
at build time, not read at runtime:

| Setting             | Value                                  |
| ------------------- | -------------------------------------- |
| `VITE_API_BASE_URL` | Base URL of the deployed Function App. |

Because Vite inlines `import.meta.env.*` during `vite build`, this must be
set **before** the build that produces the `.vsix`. Changing the API URL
means rebuilding and republishing the extension — there is no post-hoc
override.

---

## Deploying the API

```bash
npm run build --workspace @prsync/api
func azure functionapp publish <function-app-name>
```

---

## Packaging and publishing the extension

```bash
# 1. Build the panel (VITE_API_BASE_URL must be set — see above).
npm run build --workspace @prsync/extension

# 2. Package the built dist/ into a .vsix.
npm run package --workspace @prsync/extension
```

`npm run package` runs `tfx extension create --manifest-globs
vss-extension.json` and writes `<publisher>.prsync-<version>.vsix` into
`packages/extension/`.

Before the first package:

- Replace `"publisher": "REPLACE_WITH_PUBLISHER_ID"` in
  `packages/extension/vss-extension.json` with your Marketplace publisher
  id. `tfx` will package with the placeholder, but the upload is rejected.
- Bump `"version"` for every upload — the Marketplace rejects a version it
  has already seen.

The manifest addresses two things, and `tfx` ships both:

- `dist/index.html` — the panel itself, built with Vite's `base: "./"` so
  its assets are addressed _relatively_. An absolutely-addressed bundle
  asks the ADO host for `/assets/...` — a path that belongs to ADO, not to
  the extension — and the panel renders blank.
- `assets/icon-ado-128.png` — the Marketplace listing icon. This is a
  copy of the repo-root `assets/icon-ado-128.png`, kept inside the
  extension package because `tfx` only packages files beneath the
  manifest's own directory. Re-copy it if the master icon changes.

Then upload the `.vsix` at
<https://marketplace.visualstudio.com/manage/publishers/> and share the
extension with the org that will install it. For a private portfolio or
team install, publish it as **private** and share it with your org rather
than making it public.

---

## Verifying a deploy

1. Open any pull request in the ADO org and select the **PRSync** tab.
2. The panel renders (a round, or an empty state) rather than a spinner
   that never resolves or a "couldn't load" error.
3. Switch ADO between light and dark theme (**User settings → Theme**) —
   the panel follows, because it opts into the host's theme cascade at
   init and hardcodes no colours of its own.
4. The panel's height matches its content, with no inner scrollbar and no
   dead space below it.

A panel stuck on "couldn't load" with nothing in the Function App logs is
the CORS prerequisite above, every time.
