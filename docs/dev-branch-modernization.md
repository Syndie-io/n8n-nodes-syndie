# `dev` branch — modernization & fixes (2026-06-17)

Reference for everything changed on the `dev` branch relative to `master`
(`n8n-nodes-syndie@0.1.9`). Nothing here has been published to npm — see
[§7](#7-publishing--npm-safety).

To see the raw diff: `git diff master..dev`.

---

## 1. Why

Two goals:

1. **Fix a publish-breaking bug** that would stop the node loading in n8n.
2. **Migrate to the current n8n community-node toolchain** (`@n8n/node-cli`,
   ESLint 9 flat config) and the mandatory GitHub-Actions-with-provenance
   publish path required for verified nodes from 1 May 2026.

Syndie branding, OAuth endpoints, backend URLs, author, and repository were all
kept as-is. Only tooling and the documented bugs changed.

---

## 2. Bug fixes

### 2.1 🔴 Critical — node never loaded (manifest path mismatch)
`package.json` registered `dist/nodes/Syndie/Syndie.node.js`, but the source is
`SyndieTrigger.node.ts` → compiles to `SyndieTrigger.node.js`. After a build n8n
looked for a file that doesn't exist, so the node would not appear once
installed. (This is gap #1 in [`n8n-trigger.md` §5](./n8n-trigger.md).)

**Fix:** `package.json` → `n8n.nodes` now points at
`dist/nodes/Syndie/SyndieTrigger.node.js`. Verified: the path exists in `dist/`
after `pnpm run build`.

### 2.2 🟠 `delete` never unsubscribed — now implemented
Previously `delete` was a no-op (`return true`), so deactivating a workflow left
a live `target_url` on the backend. The backend **does** expose
`DELETE /n8n/hooks/:webhookId` (`automation.service.ts` `unsubscribe`, see
[`n8n-trigger.md` §5.3](./n8n-trigger.md)). Implemented properly:

- **`create`** now captures the webhook id returned by `/hooks/subscribe`
  (`response.id ?? response.data.id`) and stores it via
  `this.getWorkflowStaticData('node').webhookId`.
- **`delete`** reads that id, derives the unsubscribe URL from the Backend URL
  (`.../n8n/hooks/subscribe` → `.../n8n/hooks/<id>`), and calls `DELETE`.
  - A `404` is treated as success ("already gone").
  - Any other error is thrown (so genuine failures are visible) and the stored
    id is **kept** so a later retry can still unsubscribe.
  - If no id was stored (workflow activated before this version), `delete` is a
    safe no-op.

### 2.3 `checkExists` — left returning `false` (intentional)
The backend deduplicates identical subscriptions
([`n8n-trigger.md` §5.4](./n8n-trigger.md)), so always re-creating is tolerable.
Comment updated to say so. Not changed in behavior.

### 2.4 🟡 Minor cleanups
- Removed the stray `pairedItem: { item: 0 }` on the trigger output (a trigger
  has no input item to pair to).
- Loose `catch (error)` typing retained (compiles via
  `useUnknownInCatchVariables: false`), consistent with the original.

---

## 3. Toolchain migration

| Area | Before (`master`) | After (`dev`) |
| ---- | ----------------- | ------------- |
| Build | `rimraf + tsc + gulp build:icons` | `n8n-node build` |
| Lint | ESLint 8 + `.eslintrc.js` (+ `.prepublish`) | ESLint 9 flat config (`eslint.config.mjs`) |
| Icons | gulp copy | handled by `n8n-node build` |
| Publish | manual `npm publish` | `n8n-node release` via GitHub Actions (provenance) |
| Package manager | npm (`package-lock.json`) | pnpm (`pnpm-lock.yaml`) |

### Files removed
- `.eslintrc.js`, `.eslintrc.prepublish.js`
- `gulpfile.js`
- `package-lock.json` (replaced by `pnpm-lock.yaml`)
- `index.js` (empty; n8n loads via the `n8n` manifest, not `main`)
- `package.json` `main` field

### Files added
- `eslint.config.mjs` — re-exports `@n8n/node-cli/eslint`
- `pnpm-workspace.yaml` — pnpm 11 build-script approvals (`isolated-vm` skipped;
  it's a runtime-only native dep)
- `.github/workflows/ci.yml` — lint + build on push/PR (main, master, dev)
- `.github/workflows/publish.yml` — tag-triggered npm publish with provenance
- `nodes/Syndie/SyndieTrigger.node.json` — node codex metadata
- `nodes/Syndie/SyndieLogo.dark.svg` + `credentials/SyndieLogo*.svg` — dark icon
  variant and credential-side icons

### Files changed
- `package.json` — modern scripts, deps (`@n8n/node-cli`, eslint 9, prettier
  3.6, release-it 19, typescript 5.9), `n8n.strict: true`, fixed node path,
  version bump (§5).
- `tsconfig.json` — trailing commas removed (otherwise identical).
- `nodes/Syndie/SyndieTrigger.node.ts` — `icon` now `{ light, dark }`, added
  `subtitle` + `usableAsTool`, lifecycle fix (§2.2), pairedItem removed.
- `credentials/SyndieOAuth2Api.credentials.ts` — added `icon`
  (required by the new lint rule). `documentationUrl` (Google Doc) unchanged.

### New lint rules satisfied
The ESLint 9 n8n config flagged 4 things the old toolchain ignored, all fixed:
credential `icon`, node `subtitle`, node `usableAsTool`, and node-vs-credential
icon presence.

---

## 4. Dev workflow

```bash
pnpm install        # respects pnpm-workspace.yaml build approvals
pnpm run dev        # build + watch, links into a local n8n
pnpm run lint       # n8n community-node lint (ESLint 9)
pnpm run build      # production build into dist/
pnpm run format     # prettier
```

---

## 5. Package rename + fresh version: `@syndie/n8n-nodes-syndie@0.1.0`

The original unscoped `n8n-nodes-syndie` was published under a **different npm
account** we no longer control, and npm package names are global and permanent —
we can't re-publish or take over that name. So this is a **fresh, scoped package**
under the `syndie` org:

- `package.json` `name` → `@syndie/n8n-nodes-syndie`.
- `version` reset to `0.1.0` (a new package starts fresh; the old `0.1.x` history
  belongs to the other account).
- Added `publishConfig.access: "public"` — scoped packages publish privately by
  default, which would fail for a community node.

Installs in n8n as `@syndie/n8n-nodes-syndie`. n8n supports scoped community-node
names (`@scope/n8n-nodes-*`).

### First-publish bootstrap (Method 2 → Method 1)
npm Trusted Publishing (OIDC) is configured on the **package's settings page**,
which doesn't exist until the package has been published once. So the **first**
publish uses an `NPM_TOKEN` (Option B in `publish.yml`) — token auth still emits
provenance because the workflow sets `id-token: write`. After the first release:
configure the Trusted Publisher on the package, switch `publish.yml` back to
Method 1 (OIDC), and delete the `NPM_TOKEN` secret.

---

## 6. Verification

On `dev`, all green (exit 0):

- `pnpm install` ✅
- `pnpm run build` ✅ — `dist/nodes/Syndie/SyndieTrigger.node.js` and
  `dist/credentials/SyndieOAuth2Api.credentials.js` both exist and match
  `package.json`.
- `pnpm run lint` ✅

Not verified here (needs the live Syndie backend): the actual `DELETE` round-trip
and the exact field name of the id returned by `/hooks/subscribe`. The code
reads `response.id ?? response.data.id` — confirm against the real subscribe
response and adjust if the backend nests it differently.

---

## 7. Publishing & npm safety

**Committing or pushing the `dev` branch does NOT change the npm package.**
A publish only happens when a version **tag** (`*.*.*`) is pushed, which triggers
`.github/workflows/publish.yml` → `npm publish` with provenance.

To release `0.1.0` (first publish of `@syndie/n8n-nodes-syndie`):
1. Merge `dev` → the default branch.
2. Create a Granular Access Token on npm (scoped to the `@syndie` org, read+write)
   and add it as the `NPM_TOKEN` repo secret — the first publish uses Method 2
   (see §5 and the comments in `publish.yml`).
3. Push tag `0.1.0` (or run `pnpm run release`, which bumps/tags/pushes).
4. After it lands: add the Trusted Publisher on the package settings page, switch
   `publish.yml` to Method 1 (OIDC), and delete the `NPM_TOKEN` secret.

---

## 8. Still open (not addressed here)

From [`n8n-trigger.md` §5](./n8n-trigger.md), unchanged on this branch:
- No `event_type` selection — every workflow subscribes to the `default` stream.
- No payload signature verification (HMAC) on inbound events.
- Real vs. test payload shapes disagree (§4b) — a backend-side fix.
