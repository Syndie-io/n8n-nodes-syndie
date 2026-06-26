# Architecture

This document explains **how `@syndie/n8n-nodes-syndie` is put together** so a
developer who has never seen the repo can understand it, change it, and ship it
with confidence. For *user*-facing setup, see [README.md](./README.md); for the
local dev loop and releasing, see [CONTRIBUTING.md](./CONTRIBUTING.md).

## 1. What this package is

An [n8n community node](https://docs.n8n.io/integrations/community-nodes/) package
that connects n8n workflows to [Syndie](https://syndie.io). It ships **two nodes**
that share **one credential**:

| Piece | Direction | File |
| ----- | --------- | ---- |
| **Syndie Trigger** | Syndie → n8n (reverse webhook) | `nodes/Syndie/SyndieTrigger.node.ts` |
| **Syndie** (action) | n8n → Syndie (create lead) | `nodes/Syndie/Syndie.node.ts` |
| **Syndie OAuth2 API** (credential) | shared auth | `credentials/SyndieOAuth2Api.credentials.ts` |

There is no runtime code beyond these three files (plus icons and JSON codex
metadata). n8n loads the package by reading the `n8n` attribute in
`package.json`, not a `main` entry point.

## 2. Repository layout

```
credentials/
  SyndieOAuth2Api.credentials.ts   # OAuth2 (PKCE) credential + SYNDIE_API_BASE_URL
  SyndieLogo.svg / .dark.svg       # credential icons
nodes/Syndie/
  Syndie.node.ts                   # action node (Lead → Create)
  Syndie.node.json                 # codex metadata (categories, doc links)
  SyndieTrigger.node.ts            # webhook trigger node
  SyndieTrigger.node.json          # codex metadata
  SyndieLogo.svg / .dark.svg       # node icons
docs/                              # deep-dive references (see §6)
dist/                              # build output (git-ignored, published to npm)
.github/workflows/                 # ci.yml (lint+build), publish.yml (provenance)
package.json                       # the `n8n` attribute registers nodes + credential
```

## 3. The single source of truth: `SYNDIE_API_BASE_URL`

`credentials/SyndieOAuth2Api.credentials.ts` exports one constant:

```ts
export const SYNDIE_API_BASE_URL = 'https://api.syndie.io';
```

Everything that talks to Syndie derives its URL from this:

- The credential's hidden `authUrl` / `accessTokenUrl` (OAuth authorize + token).
- The action node's `CREATE_LEAD_URL` (imports the constant).
- The trigger node's `SUBSCRIBE_URL` (imports the constant).

It is **hardcoded to production on purpose.** The public / verified node only ever
connects to `api.syndie.io` — there is no environment selector and no free-text
URL override, which keeps the UI simple and satisfies n8n's verification rules
(no arbitrary outbound URLs). Internal beta/localhost testing lives on a separate,
unpublished branch that re-adds those options.

> If the production host ever changes, change it in this one place and rebuild.

## 4. Authentication (OAuth2 + PKCE)

The credential `extends` n8n's built-in `oAuth2Api`, so n8n drives the whole
OAuth dance. The credential only pins the Syndie-specific bits:

- `grantType: authorizationCode`, `pkce: true` (public client, no secret).
- `authUrl` / `accessTokenUrl` derived from `SYNDIE_API_BASE_URL`.
- Token placed in the `Authorization` header; refresh re-sends credentials.
- The user supplies a single field: **Client ID**.

Both nodes call the backend with
`this.helpers.httpRequestWithAuthentication.call(this, 'syndieOAuth2Api', …)`,
which injects the bearer token and refreshes it transparently.

> **Backend prerequisite:** the n8n redirect URI
> `https://<n8n-host>/rest/oauth2-credential/callback` must be allowlisted on the
> Syndie backend or "Connect" is rejected.

## 5. How each node works

### Action — `Syndie.node.ts` (Lead → Create)
- Resource **Lead**, Operation **Create**. All lead fields live under
  **Additional Fields** and are optional.
- `execute()` loops over input items. For each item it builds a body from the
  non-empty optional fields (trimmed) plus `automationId` (the n8n workflow id,
  so leads trace back to their source automation), then
  `POST`s to `CREATE_LEAD_URL`.
- **Continue On Fail** turns a failing item into `{ error }` instead of aborting.
- Full request/response contract: [docs/n8n-action.md](./docs/n8n-action.md).

### Trigger — `SyndieTrigger.node.ts` (reverse webhook)
Implements n8n's webhook lifecycle:
- **`create`** (on activation): POSTs n8n's own webhook URL to `SUBSCRIBE_URL`,
  then stores the returned backend `webhookId` in workflow static data.
- **`webhook`** (on each event): emits the incoming POST body as the first item.
- **`checkExists`**: always `false` — the backend deduplicates, so `create`
  re-runs on every activation.
- **`delete`** (on deactivation): `DELETE`s `.../hooks/<webhookId>`; `404` counts
  as success; other errors keep the stored id for a retry.
- Lifecycle, payload shapes, and known gaps: [docs/n8n-trigger.md](./docs/n8n-trigger.md).

## 6. Build, registration, and publishing

- **Toolchain:** `@n8n/node-cli` (`n8n-node build` / `lint`). TypeScript →
  CommonJS into `dist/`, mirroring the source tree; icons and `*.node.json` are
  copied alongside.
- **Registration:** `package.json` → `n8n` attribute lists the compiled paths:
  ```json
  "n8n": {
    "n8nNodesApiVersion": 1,
    "credentials": ["dist/credentials/SyndieOAuth2Api.credentials.js"],
    "nodes": ["dist/nodes/Syndie/SyndieTrigger.node.js", "dist/nodes/Syndie/Syndie.node.js"]
  }
  ```
  These paths **must** match the build output, or n8n silently fails to load the
  node.
- **Publishing:** pushing a version tag triggers `.github/workflows/publish.yml`,
  which publishes to npm **with a provenance attestation** via GitHub Actions —
  mandatory for verified nodes since 1 May 2026. See
  [CONTRIBUTING.md](./CONTRIBUTING.md) for the release steps and the verification
  submission process.

## 7. Deeper references

- [docs/n8n-action.md](./docs/n8n-action.md) — action node + backend contract.
- [docs/n8n-trigger.md](./docs/n8n-trigger.md) — trigger lifecycle, payload shapes.
- [docs/testing-self-hosted.md](./docs/testing-self-hosted.md) — end-to-end test
  on a publicly-reachable n8n.

