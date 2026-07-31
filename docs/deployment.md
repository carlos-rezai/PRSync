# Deployment

What has to be true before PRSync works in a real Azure DevOps
organization. Read the prerequisites first — every one of them fails
_silently_ from the panel's point of view if it is skipped.

Scope: all three deployables — the API (`packages/api`), the extension
panel (`packages/extension`) and the Teams bot (`packages/bot`). The API
and the bot are **two separate Function Apps** that share no code and no
synchronous call: a Storage Queue is the entire boundary between them.
That is deliberate — see [Accepted costs](#accepted-costs) at the end.

This is a reference, read by lookup rather than straight through. The
ordered path — what to do first, what cannot be swapped, and how you
know each step worked — is [`setup-guide.md`](setup-guide.md), whose
eleven stages link back to the sections here for every value and every
failure. If you are standing PRSync up for the first time, start there
and let it send you back.

### What's in here

The five prerequisites, each of which fails _silently_ from the panel's
point of view when it is skipped:

- [Function App CORS must allow the ADO org origin](#prerequisite-function-app-cors-must-allow-the-ado-org-origin)
- [The tables and the queue must already exist](#prerequisite-the-tables-and-the-queue-must-already-exist)
- [API configuration](#prerequisite-api-configuration)
- [Panel configuration](#prerequisite-panel-configuration)
- [Bot configuration](#prerequisite-bot-configuration)

Getting each of the three deployables up:

- [Registering the Azure Bot resource](#registering-the-azure-bot-resource)
- [Deploying the API](#deploying-the-api)
- [Deploying the bot](#deploying-the-bot)
- [Packaging and sideloading the Teams app](#packaging-and-sideloading-the-teams-app)
- [Packaging and publishing the extension](#packaging-and-publishing-the-extension)

Rationale, checks and the trades taken knowingly:

- [Why `/api/messages` is anonymous, and why that is not an open endpoint](#why-apimessages-is-anonymous-and-why-that-is-not-an-open-endpoint)
- [Local development](#local-development)
- [Verifying a deploy](#verifying-a-deploy)
- [Accepted costs](#accepted-costs)

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

## Prerequisite: the tables and the queue must already exist

Nothing in either package creates storage on the way past — no
`createTable`, no `createIfNotExists`, no `createQueue`. Every client is
built from a connection string against a name that is expected to be
there already.

Create these before the first deploy:

| Kind  | Name                   | Read/written by                                        |
| ----- | ---------------------- | ------------------------------------------------------ |
| Table | `Rounds`               | `packages/api` — one round per row                     |
| Queue | `prsync-notifications` | `packages/api` writes, `packages/bot` reads            |
| Table | `TeamsIdentities`      | `packages/bot` — one conversation reference per person |
| Table | `NotificationLog`      | `packages/bot` — one row per delivery attempt          |

```bash
CS="<storage-connection-string>"
az storage table create --name Rounds            --connection-string "$CS"
az storage table create --name TeamsIdentities   --connection-string "$CS"
az storage table create --name NotificationLog   --connection-string "$CS"
az storage queue create --name prsync-notifications --connection-string "$CS"
```

They may all live in one storage account or be split across two — the
settings below keep the tables and the queue independently addressable
precisely so the two Function Apps can share an account or not.

A missing queue is the worst of these: the API's enqueue fails, and
`QueueNotificationPort` logs and continues by design so that a
notification failure can never roll back a committed round. Rounds keep
opening and closing correctly and no DM ever arrives.

---

## Prerequisite: API configuration

`packages/api` reads all of its configuration at host start, in
`readApiConfig`. A missing connection string throws there rather than
failing one request at a time:

| Setting                          | Value                                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `AZURE_TABLES_CONNECTION_STRING` | Required. The Table Storage connection string for the `Rounds` table.                                            |
| `AZURE_QUEUES_CONNECTION_STRING` | Required. The Queue Storage connection string the notification producer writes to.                               |
| `PRSYNC_NOTIFICATION_QUEUE_NAME` | Optional; defaults to `prsync-notifications`. **Must match the bot's queue.**                                    |
| `PRSYNC_DEFAULT_QUORUM`          | Optional; defaults to `2`. A non-whole number is rejected at start rather than silently replaced by the default. |

Set them as Function App application settings (locally, in
`local.settings.json`, which is git-ignored).

`AZURE_QUEUES_CONNECTION_STRING` is required rather than optional for a
sharp reason: an API that starts perfectly healthy and quietly notifies
nobody is the exact failure this product exists to prevent. Nothing lazy
would discover it — no request 500s and no round misbehaves.

If you override `PRSYNC_NOTIFICATION_QUEUE_NAME` on one Function App,
override it on the other. The queue name is the only place the two apps
meet, and a disagreement is a queue that fills on one side while the
worker listens to an empty one on the other, with nothing red anywhere.

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

## Prerequisite: bot configuration

`packages/bot` reads its four Bot Framework settings in `readBotConfig`,
at host start, and refuses to start without any of them. That is
deliberate: a missing password or a silently-defaulted tenant produces a
bot that accepts tokens it should not, or accepts none at all, and either
way the only symptom is DMs that never arrive.

| Setting                                | Value                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| `MICROSOFT_APP_ID`                     | Required. The Azure Bot's app registration **Application (client) ID**.                    |
| `MICROSOFT_APP_PASSWORD`               | Required. A client secret on that app registration.                                        |
| `MICROSOFT_APP_TENANT_ID`              | Required. The **Directory (tenant) ID** the bot is registered in.                          |
| `MICROSOFT_APP_TYPE`                   | Required, and must be exactly `SingleTenant` — the bot throws on any other value.          |
| `AZURE_TABLES_CONNECTION_STRING`       | Required. The Table Storage connection string for `TeamsIdentities` and `NotificationLog`. |
| `PRSYNC_NOTIFICATION_QUEUE_NAME`       | Optional; defaults to `prsync-notifications`. Must match the API's.                        |
| `AZURE_QUEUES_CONNECTION_STRING`       | The queue trigger's default connection setting — see below.                                |
| `PRSYNC_NOTIFICATION_QUEUE_CONNECTION` | Optional. The **name of** the setting holding the queue connection string.                 |

The last two are the pair people get wrong, because one is a value and
the other is a name:

- The Functions queue trigger takes the **name of an app setting**, not a
  connection string. The worker defaults that name to
  `AZURE_QUEUES_CONNECTION_STRING`, so the ordinary deploy just sets that
  setting to the connection string and stops there.
- `PRSYNC_NOTIFICATION_QUEUE_CONNECTION` overrides which setting is read.
  Set it to `"MY_OTHER_QUEUES"` and the trigger reads the setting named
  `MY_OTHER_QUEUES`. Setting it to a connection string is the failure
  mode: the host looks for an app setting by that whole string, finds
  none, and the trigger binds to nothing.

`MICROSOFT_APP_TYPE=SingleTenant` is not a formality. PRSync is sideloaded
inside one org's tenant and will never be listed in the Teams Store;
`MultiTenant` widens the token audience to every directory in the Bot
Framework channel — a setting nobody would notice was wrong, because the
bot keeps working.

---

## Registering the Azure Bot resource

The bot must exist as an Azure Bot resource before the Function App is of
any use: the resource is what owns the app registration the adapter
authenticates with, and what connects the Teams channel.

These seven steps are deliberately not one stage of the setup guide:
steps 1 to 3 are its [stage 2](setup-guide.md#stage-2--register-the-azure-bot-and-its-secret),
step 4 is [stage 3](setup-guide.md#stage-3--deploy-the-bot-function-app),
steps 5 and 6 are [stage 4](setup-guide.md#stage-4--messaging-endpoint-and-the-teams-channel),
and step 7 is [stage 5](setup-guide.md#stage-5--allow-custom-app-upload-in-the-tenant).
The order matters — step 4 is what gives step 5 a URL to point at.

1. **Create the Azure Bot.** Portal → **Create a resource** → **Azure
   Bot**. Pricing tier **F0** (free) is sufficient. For **Type of App**
   choose **Single Tenant**, and let it create a new Microsoft App ID (or
   point it at an existing single-tenant app registration).
2. **Create a client secret.** On the bot's app registration
   (**Azure Bot → Configuration → Manage Password**, which opens the app
   registration) → **Certificates & secrets** → **New client secret**.
   Copy the value immediately; it is shown once.
3. **Record the three values.** Application (client) ID, the secret value,
   and the Directory (tenant) ID — these are `MICROSOFT_APP_ID`,
   `MICROSOFT_APP_PASSWORD` and `MICROSOFT_APP_TENANT_ID`.
4. **Deploy the bot Function App** (see below) so its URL exists.
5. **Set the messaging endpoint.** **Azure Bot → Configuration →
   Messaging endpoint**:

   ```
   https://<bot-function-app>.azurewebsites.net/api/messages
   ```

   That path is not configurable from here — it is the route
   `functions/teamsMessages` declares (`route: "messages"`), and Azure
   Functions serves HTTP routes under `/api`. Point the bot anywhere else
   and every inbound activity 404s, which Teams surfaces to the person as
   nothing at all.

6. **Enable the Teams channel.** **Azure Bot → Channels** → **Microsoft
   Teams** → agree to the terms → **Apply**. Without this the tenant has
   no route to the bot no matter what the manifest says.
7. **Allow custom app upload in the tenant.** Sideloading is a tenant
   policy: Teams admin center → **Teams apps → Setup policies** → the
   policy covering your users → **Upload custom apps: On**. PRSync is
   never listed in the Teams Store, so without this nobody can install it.

CLI equivalent for the app settings, once the ids are in hand:

```bash
az functionapp config appsettings set \
  --name <bot-function-app> \
  --resource-group <resource-group> \
  --settings \
    MICROSOFT_APP_ID=<app-id> \
    MICROSOFT_APP_PASSWORD=<client-secret> \
    MICROSOFT_APP_TENANT_ID=<tenant-id> \
    MICROSOFT_APP_TYPE=SingleTenant \
    AZURE_TABLES_CONNECTION_STRING="<connection-string>" \
    AZURE_QUEUES_CONNECTION_STRING="<connection-string>"
```

---

## Why `/api/messages` is anonymous, and why that is not an open endpoint

`functions/teamsMessages` pins `authLevel: "anonymous"` in code rather
than leaving it to a deployment setting. Both halves of the reason have
to be read together, which is the whole point of writing them down here.

**Why it must be anonymous.** Azure Bot Service is the caller, and it
cannot present an Azure Functions key. There is no field on the bot
resource to put one in, and it does not append one to the messaging
endpoint. A function-key-protected endpoint therefore never receives an
activity at all: installs capture nothing, messages get no reply, and the
Function App looks perfectly healthy while doing nothing.

**Why it is nevertheless not open.** The Bot Framework `CloudAdapter`
validates the caller on every single request, before the bot's own code
sees the activity:

- The channel sends a **bearer token** — a JWT issued by Microsoft — in
  the `Authorization` header.
- The adapter validates that JWT's signature, issuer and audience against
  the bot's own **app id** (`MICROSOFT_APP_ID`), its password
  (`MICROSOFT_APP_PASSWORD`) and its **tenant**
  (`MICROSOFT_APP_TENANT_ID`) — the values `readBotConfig` refuses to
  start without.
- Anything that fails validation gets a 401 from inside the adapter. An
  unauthenticated POST to `/api/messages` reaches no handler, touches no
  table and sends no DM.

So `authLevel: "anonymous"` moves authentication from the Functions host
to the adapter; it does not remove it. The four `MICROSOFT_APP_*` settings
**are** the authentication for this endpoint, which is why a blank one is a
start-up failure rather than a warning.

This is recorded once, deliberately, so that the pairing of "anonymous"
with "internet-facing" is understood as the required configuration rather
than re-raised as a finding in every future security review.

---

## Deploying the API

```bash
npm run build --workspace @prsync/api
func azure functionapp publish <function-app-name>
```

---

## Deploying the bot

A second Function App, published the same way:

```bash
npm run build --workspace @prsync/bot
func azure functionapp publish <bot-function-app>
```

Two functions come up from the one `main` entry point
(`packages/bot/src/index.ts` → `dist/index.js`):

- `teamsMessages` — `POST /api/messages`, the inbound half: installs,
  uninstalls and anything a teammate types.
- `notificationWorker` — the Storage Queue trigger, the outbound half: one
  queued message becomes one 1:1 DM.

In the Functions v4 model `main` **is** function discovery: the host loads
exactly the file `main` names and registers whatever that file registered.
Repointing `main` at the handler modules would start the host cleanly,
register nothing, and serve 404 for every route while looking healthy.

---

## Packaging and sideloading the Teams app

The bot is only real to a teammate once it is an installable Teams app
package.

```bash
npm run package --workspace @prsync/bot
```

That zips `packages/bot/teams/` into `packages/bot/prsync-teams.zip` —
the manifest plus the two icons, addressed relative to the zip root.

Before the first package:

- Replace `bots[0].botId` in `packages/bot/teams/manifest.json` with the
  bot's `MICROSOFT_APP_ID`. It ships as
  `00000000-0000-0000-0000-000000000000`, which is a valid GUID and so
  uploads without complaint — and then resolves to no bot, so the app
  installs and never speaks.
- Bump `"version"` for every re-upload of a changed manifest. Teams keys
  the app by `id` and will not re-read a version it has already seen.
- Leave `scopes: ["personal"]` alone. PRSync has no channel or
  group-chat surface; a bot installable into a channel is an app that
  appears to work and notifies nobody.

Then each teammate installs it once, in personal scope:

1. Teams → **Apps** → **Manage your apps** → **Upload an app** →
   **Upload a custom app**.
2. Select `prsync-teams.zip` → **Add**.

Installing is what makes someone reachable, and it is the only way they
become reachable. On install the bot receives a `conversationUpdate`
carrying **the bot itself** in `membersAdded`, asks the Teams connector
for that person's profile, and stores their email, Teams user id and
conversation reference in `TeamsIdentities`. Nothing else creates that
row — a reviewer who never sideloaded PRSync resolves to no identity, is
logged `no-identity`, and their round proceeds exactly as normal without
them ever being told.

Messaging the bot anything at all replies with a short confirmation and
refreshes the stored reference. Uninstalling deletes the row: a reference
kept past an uninstall burns the full retry budget into the poison queue
on every future round, and it is PII PRSync no longer has a reason to
hold.

One zip serves everyone — it carries no per-person data. Distribute the
same file (or have an admin publish it to the org's app catalogue, which
does not require a Teams Store listing).

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

## Local development

The panel and the API run locally with nothing exotic. The bot needs two
extra things, because it is reached _by_ Azure rather than reaching out:
somewhere to put the queue, and a public URL for Azure Bot Service to
POST to.

### Azurite, for the queue and the tables

[Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite)
is the storage emulator. Start it once and leave it running:

```bash
npx azurite --silent --location ./.azurite
```

Both Function Apps then point at it with the well-known development
connection string, and — because nothing in either package creates
storage — the tables and the queue still have to be created against the
emulator exactly as they do in Azure:

```bash
CS="UseDevelopmentStorage=true"
az storage table create --name Rounds            --connection-string "$CS"
az storage table create --name TeamsIdentities   --connection-string "$CS"
az storage table create --name NotificationLog   --connection-string "$CS"
az storage queue create --name prsync-notifications --connection-string "$CS"
```

`packages/api/local.settings.json` (git-ignored):

```json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "AZURE_TABLES_CONNECTION_STRING": "UseDevelopmentStorage=true",
    "AZURE_QUEUES_CONNECTION_STRING": "UseDevelopmentStorage=true"
  }
}
```

`packages/bot/local.settings.json` (git-ignored) — the same storage plus
the four Bot Framework settings, which are the **real** ones from the
Azure Bot resource. There is no local substitute for them: the adapter
validates a real Microsoft-issued token against a real app registration.

```json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "AZURE_TABLES_CONNECTION_STRING": "UseDevelopmentStorage=true",
    "AZURE_QUEUES_CONNECTION_STRING": "UseDevelopmentStorage=true",
    "MICROSOFT_APP_ID": "<app-id>",
    "MICROSOFT_APP_PASSWORD": "<client-secret>",
    "MICROSOFT_APP_TENANT_ID": "<tenant-id>",
    "MICROSOFT_APP_TYPE": "SingleTenant"
  }
}
```

Run each app from its own package, on its own port — the API takes 7071
by default, so give the bot another:

```bash
npm run build --workspace @prsync/api && (cd packages/api && func start)
npm run build --workspace @prsync/bot && (cd packages/bot && func start --port 7072)
```

### A tunnel, for the messaging endpoint

Azure Bot Service has to reach `/api/messages`, and `localhost:7072` is
not a place it can reach. Expose the port and point the bot at the public
URL:

```bash
# Either dev tunnels...
devtunnel host -p 7072 --allow-anonymous
# ...or ngrok
ngrok http 7072
```

Then set **Azure Bot → Configuration → Messaging endpoint** to
`https://<tunnel-host>/api/messages` and **Apply**. Installing the app in
Teams now drives your local bot: a row appears in the local
`TeamsIdentities` table, and messaging it replies.

That endpoint is a single field on one shared resource, so a second
Azure Bot resource for development is worth it if more than one person
does this — whoever set it last owns the traffic, and the deployed bot
stops receiving activities entirely while a tunnel is pointed at it.
Remember to point it back at
`https://<bot-function-app>.azurewebsites.net/api/messages` when you are
done.

### Exercising the worker without the panel

The queue is the boundary, so the outbound half needs no ADO, no panel
and no round — a message on the queue is the whole input. Enqueue one by
hand and a real DM lands:

```bash
# The trigger decodes base64 by default, so the message must be encoded.
MSG='{"schemaVersion":1,"event":"roundOpened","prKey":"proj:repo:42","roundNumber":1,"recipient":{"adoId":"ado-1","email":"you@example.com","displayName":"You"},"card":{"roundLabel":"Round 1","prTitle":"A pull request","prUrl":"https://dev.azure.com/org/proj/_git/repo/pullrequest/42","authorName":"Someone"}}'
az storage message put \
  --queue-name prsync-notifications \
  --content "$(printf '%s' "$MSG" | base64 -w0)" \
  --connection-string "UseDevelopmentStorage=true"
```

Use an `email` that has actually installed the bot; anything else is
recorded `no-identity` in `NotificationLog` and no DM is sent, which is
correct behaviour and looks identical to a broken worker.

If the DM never arrives and nothing is red, check the encoding first. The
queue trigger expects base64 and the `messageEncoding: "none"` opt-out is
extension-bundle 5.0.0+, while both `host.json` files pin
`[4.*, 5.0.0)` — so an unencoded message is silently not what the trigger
decodes.

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

Then the notification path, which is only verifiable end to end because
its two halves are separately observable:

5. Sideload `prsync-teams.zip` as two different people and message the bot
   from each. Both get the confirmation reply, and `TeamsIdentities` has
   two rows.
6. Click **Ready for review** on a PR that has both of them as reviewers.
   Each gets a round-opened DM naming the PR and the round label — the
   label as it stood when the button was clicked.
7. Have each reviewer tick **Done**. When the round closes, the **author**
   gets the "safe to proceed" DM, and nobody else does.
8. `NotificationLog` has one row per attempt, keyed
   `{roundNumber}|{event}|{recipientAdoId}` under `PartitionKey = prKey`,
   each `sent`, `no-identity` or `failed`.

Where to look when a DM does not arrive, in the order that narrows it
fastest:

| Symptom                                       | Where the path broke                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Messages sitting in `prsync-notifications`    | The worker is not triggering — queue name or connection setting on the bot.                                        |
| Messages in `prsync-notifications-poison`     | Deliveries exhausted their retries — a real Bot Framework or network fault; the `failed` rows name the recipients. |
| Queue empty, no `NotificationLog` rows at all | The API never enqueued. Look for the producer's `Enqueuing a … notification failed` log line.                      |
| `NotificationLog` row says `no-identity`      | That person never sideloaded the bot, or their ADO email does not match their Teams address. Working as designed.  |
| Install captures nothing, bot never replies   | The messaging endpoint, the Teams channel, or a tunnel still pointed at somebody's laptop.                         |

---

## Accepted costs

These are deliberate trades, recorded so the next person to read the repo
can tell them apart from oversights.

- **Two deploy targets, two sets of app settings, and a queue to
  operate.** The API and the bot are separate Function Apps that share no
  code and no synchronous call. It buys independent deploys, no
  cross-service auth, and a bot that can be down, slow or not yet deployed
  without a round ever noticing — at the cost of `AZURE_TABLES_CONNECTION_STRING`
  and the queue settings being configured twice, in two blades, and of a
  queue name that has to agree across both.
- **The queue envelope type is declared twice.** `NotificationMessage` is
  declared in `packages/api/src/services/QueueNotificationPort/` and again,
  structurally narrower, in `packages/bot/src/lib/types/`. Nothing links
  the packages, and a message is read by a build that may no longer be the
  one that wrote it, so `schemaVersion` carries the compatibility contract
  instead of the compiler. A shared `contracts` package was ruled out:
  it would reintroduce a workspace-dependency packaging problem for both
  apps to solve a twenty-line type.
- **Duplicate DMs are possible by design.** Delivery is ordered check →
  send → mark, so the narrow window where a send succeeds and the mark
  fails yields a second DM on redelivery rather than a lost one. Chosen
  deliberately over silent loss: a missing "safe to proceed" is the exact
  failure this product exists to prevent.
- **Local development needs Azurite plus a tunnel.** The bot is reached by
  Azure rather than reaching out, so there is no way to exercise the
  inbound half from a laptop without exposing a port — see
  [Local development](#local-development).
- **The source walker is duplicated.** `readSourceFiles` — twenty-five
  lines that return every `.ts` file under a root, with its text — exists
  in both `packages/bot/src/test/fixtures/` and
  `packages/docs/src/repo/sourceFiles/`. The bot's policy test needs a
  walker over the bot's own source, and the documentation tests need one
  over every package; sharing a single copy means a
  workspace-to-workspace dependency, which is the same packaging problem
  already declined for `NotificationMessage` above and for `statusCodeOf`.
  One copy per consumer, each with its own test. Unlike the queue
  envelope, this one is test-only and cannot reach a deploy at all.
