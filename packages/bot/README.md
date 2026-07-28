# @prsync/bot

The Teams side of PRSync: a Bot Framework bot that sends each person the
one thing that concerns them as a personal 1:1 DM — reviewers when a
round opens, the author when it closes.

## The Teams app package

`teams/` holds everything a teammate uploads to Teams:

| File                        | What it is                                                     |
| --------------------------- | -------------------------------------------------------------- |
| `manifest.json`             | The app manifest — personal scope only, no channel surface     |
| `icon-teams-color-192.png`  | 192×192 full-bleed colour icon (copy of `assets/`'s)           |
| `icon-teams-outline-32.png` | 32×32 white-on-transparent outline glyph (copy of `assets/`'s) |

```
npm run package --workspace @prsync/bot
```

zips those three files — at the zip root, which is where Teams resolves
manifest paths from — into `packages/bot/prsync-teams.zip`. That is the
file a teammate sideloads (Teams → Apps → Manage your apps → Upload a
custom app). The zip is a build output and is git-ignored.

`src/test/packaging.test.ts` asserts the manifest's contract — scope,
addressed paths, icon dimensions, required fields — so a package that
Teams would reject goes red in the suite rather than at upload time.

### Before the first real install

`manifest.json`'s `bots[0].botId` is the all-zero placeholder GUID. It
must be replaced with the **application (client) ID of the Azure Bot
resource** — the same value that becomes `MICROSOFT_APP_ID` — before the
package will connect to anything. The top-level `id` is the app's own
identity and is already a real GUID; leave it alone, since changing it
makes Teams treat an upgrade as a different app.

`developer.privacyUrl` and `developer.termsOfUseUrl` currently both point
at the repository. They need real pages before PRSync goes anywhere
beyond sideloading inside one tenant.

## Manifest schema

Pinned to [v1.29][schema] (`manifestVersion: "1.29"`), the current
published version. The packaging test asserts `$schema` and
`manifestVersion` agree, so bumping one without the other goes red.

[schema]: https://learn.microsoft.com/en-us/microsoftteams/platform/resources/schema/manifest-schema
