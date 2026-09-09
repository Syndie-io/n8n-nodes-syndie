# Architecture

How `@syndie/n8n-nodes-syndie` is put together, for someone who has not seen the
repository before. User-facing setup is in [README.md](./README.md); the dev loop
and releasing are in [CONTRIBUTING.md](./CONTRIBUTING.md).

## 1. What this package is

An [n8n community node](https://docs.n8n.io/integrations/community-nodes/) package
with two nodes and one credential:

| Piece | Direction | File |
|---|---|---|
| **Syndie Trigger** | Syndie → n8n, six events, signed | `nodes/Syndie/SyndieTrigger.node.ts` |
| **Syndie** (action) | n8n → Syndie, import or find a lead | `nodes/Syndie/Syndie.node.ts` |
| **Syndie OAuth2 API** | shared credential | `credentials/SyndieOAuth2Api.credentials.ts` |

Shared logic lives in `nodes/Syndie/GenericFunctions.ts`, the file community
nodes conventionally keep such helpers in. There is no runtime dependency beyond
`n8n-workflow` (a peer) and Node's built-in `crypto`.

## 2. Repository layout

```
credentials/
  SyndieOAuth2Api.credentials.ts   # OAuth2 + PKCE; the API Base URL field
nodes/Syndie/
  GenericFunctions.ts              # events, URLs, subscribe-reply reader, signature check
  SyndieTrigger.node.ts            # subscribe / verify / unsubscribe
  Syndie.node.ts                   # import-lead / find-lead
  *.node.json                      # codex metadata (category Sales, doc links)
  SyndieLogo*.svg                  # icons
scripts/self-test.mjs              # drives dist/ with a stubbed n8n (pnpm test)
docs/                              # the references linked from the codex files
.github/workflows/                 # ci.yml (lint, build, test, pack guard), publish.yml
```

n8n loads the package through the `n8n` attribute in `package.json`, which lists
the compiled paths under `dist/`; those paths must match the build output.

## 3. Where the API address comes from

The credential has a visible **API Base URL** field, defaulting to
`https://api.syndie.io`. The hidden authorize and token URLs are expressions over
it (`$self["baseUrl"]`), and both nodes read it through `getSyndieBaseUrl()`,
which strips a trailing slash and refuses anything but https. Every request URL
is then `syndieApiUrl(base, path)` = base + `/api/integrations/automation/n8n` +
path. One field moves the whole package to a staging backend or a tunnel.

## 4. Authentication

The credential extends n8n's `oAuth2Api`: Authorization Code with PKCE, token in
the `Authorization` header, credentials re-sent on refresh. The backend is the
OAuth server; it serves both grants on `/oauth/token`, validates the client id
against its own configuration (blank = the connector is off, 503), accepts n8n's
standard redirect path on any https host, binds the code exchange to the
redirect used at authorize, and stores tokens hashed. Both nodes call the backend
with `httpRequestWithAuthentication`, which injects and refreshes the token.

## 5. The trigger

**Activation** turns the Events setting into subscriptions: all six → one
`default` subscription (also what 0.3.x sent), a subset → one per event. Each
subscribe answers with an id and a signing secret, which the node keeps in its
static data as `subscriptions[]`. A failure part-way removes what was created and
raises once.

**Delivery** is checked before a run starts: the subscription id header selects
the secret, `X-Webhook-Signature` (`t=…,v1=…`) is verified as HMAC-SHA256 of
`"<t>.<raw body>"` in constant time with a five-minute window, and anything else
is answered `401` with `noWebhookResponse`. A workflow activated on 0.3.x holds no
secret and is let through with a warning until re-activated.

**Deactivation** deletes every remembered subscription, treats 404 as done, and
keeps failures on record for the next attempt.

## 6. The action

Import posts the filled-in fields to `actions/import-lead`; the backend matches
by public identifier, then email, inside the workspace and answers
`{ created, lead }`. Find gets `actions/find-lead` with `linkedin` and/or `email`
and answers `{ found, lead }`. Both keep the stored operation values (`create`,
`find`) stable so saved workflows open; validation happens before any request and
names the item.

## 7. Build, test, publish

- **Build:** `@n8n/node-cli` (`n8n-node build`), TypeScript → CommonJS in `dist/`.
  `tsconfig` is not incremental and does not include `package.json`, so the
  tarball carries no build cache and no stray `dist/package.json`; CI fails if
  either reappears.
- **Lint:** `n8n-node lint`, the same rules n8n's verification runs.
- **Test:** `pnpm test` runs `scripts/self-test.mjs` against `dist/`.
- **Publish:** pushing a `*.*.*` tag runs `publish.yml`, which publishes with an
  npm provenance attestation through GitHub OIDC (required for verified nodes).
