# Syndie → Zapier Integration Roadmap

How to build the Zapier equivalent of the existing n8n node.

## TL;DR after reading the backend (`api-engine`)

**Your backend is already Zapier-ready.** You do **not** need to build new
endpoints — the automation module is provider-generic and already lists `zapier`
as a first-class provider. Confirmed in `api-engine`:

- `automation-providers.registry.ts` → `AutomationProvider = 'zapier' | 'n8n' | 'make'`
  and the `AutomationType` Prisma enum includes `zapier`.
- Every route is `:provider`-scoped, so the same handlers already serve Zapier:

  | Zapier needs            | Existing backend route                                   |
  | ----------------------- | -------------------------------------------------------- |
  | OAuth authorize         | `GET  /integrations/automation/zapier/oauth/authorize`   |
  | OAuth token exchange    | `POST /integrations/automation/zapier/oauth/callback`    |
  | OAuth refresh           | `POST /integrations/automation/zapier/oauth/token`       |
  | `performSubscribe`      | `POST /integrations/automation/zapier/hooks/subscribe`   |
  | `performUnsubscribe`    | `DELETE /integrations/automation/zapier/hooks/:webhookId`|
  | `performList` (samples) | `GET  /integrations/automation/zapier/hooks/recent`      |
  | test trigger            | `POST /integrations/automation/zapier/trigger`           |
  | auth `test`             | `GET  /integrations/automation/zapier/auth-test`         |

- `getSetupInfo('zapier')` already returns Zapier connect instructions.

**So the remaining work is almost entirely on the Zapier side**, plus one config
value: set the `ZAPIER_CLIENT_ID` env var (the backend's `/authorize` validates
the incoming `client_id` against it — see `INTEGRATIONS.md` §10).

> Net effect: skip §2's "build endpoints" framing below — treat it as a
> **verification checklist**, not new development.

---

## 1. Mental model: n8n vs Zapier

| Concept              | n8n (today)                                  | Zapier (target)                                  |
| -------------------- | -------------------------------------------- | ------------------------------------------------ |
| Auth                 | `oAuth2Api` credential (PKCE)                | Platform **OAuth2** auth                          |
| "Send me events"     | `create` lifecycle → POST `/hooks/subscribe` | Trigger **`performSubscribe`** (REST Hook)       |
| "Stop sending"       | `delete` (currently no-op)                   | Trigger **`performUnsubscribe`** (REST Hook)     |
| Receiving an event   | `webhook()` handler                          | Trigger **`perform`** (parses inbound payload)   |
| Sample data for UI   | n/a                                          | Trigger **`performList`** (returns examples)     |
| One "task"           | one catch-all webhook                        | one **Trigger per event type** (recommended)     |

The key shift: in Zapier, the cleanest UX is **one trigger per Syndie event
type** (e.g. "New Reply", "Connection Accepted") instead of one catch-all. This
also fixes the §4 gap in the n8n doc — you'd finally enumerate event types.

---

## 2. Backend checklist (mostly verify, not build)

The endpoints already exist (see TL;DR). What actually needs attention:

- [x] **Subscribe endpoint** — already returns `{ id, webhook: {...} }`; Zapier
      stores that `id` for teardown. ✅
- [x] **Unsubscribe endpoint** — `DELETE /:provider/hooks/:webhookId` exists. ✅
- [x] **`performList` source** — `GET /:provider/hooks/recent` exists (returns a
      hardcoded sample when the user has no leads). ✅
- [ ] **Set `ZAPIER_CLIENT_ID`** in the backend env so `/authorize` accepts
      Zapier's `client_id`.
- [ ] **Register Zapier's redirect URI** with the OAuth server.
- [ ] **Event-type catalog** — `eventType` is currently a free-form string
      defaulting to `default`. If you want per-event Zapier triggers
      (`lead_connected`, `campaign_completed`), make `campaign-engine` actually
      dispatch with those `eventType`s and have the subscribe call pass them.
- [ ] **Payload consistency** — align the real vs test payload shapes (see the
      n8n doc §4b); Zapier's `sample` must match what arrives live.
- [ ] **Payload signing** (recommended) — HMAC header on outbound events.

---

## 3. Zapier app build (Platform CLI — recommended over the visual builder)

> CLI gives you version control, matching your existing git-based n8n workflow.

### Step 0 — Scaffold
```bash
npm install -g zapier-platform-cli
zapier login
zapier init syndie-zapier --template oauth2
cd syndie-zapier
```

### Step 1 — Authentication (`authentication.js`)
Mirror the credential from `SyndieOAuth2Api.credentials.ts`, but point at the
**zapier** provider path (the backend is `:provider`-scoped):
- `type: 'oauth2'`
- `authorizeUrl`: `https://syndie.io/api/integrations/automation/zapier/oauth/authorize`
- `getAccessToken` → `POST .../automation/zapier/oauth/callback`
- `refreshAccessToken` → `POST .../automation/zapier/oauth/token`
- Enable **PKCE (S256)** — the backend's authorize endpoint supports it.
- `test`: `GET .../automation/zapier/auth-test` (purpose-built — returns
  integration info and `authenticated: true`).
- Register Zapier's redirect URI with the backend and set `ZAPIER_CLIENT_ID`.

### Step 2 — A trigger per event type (`triggers/<event>.js`)
Each trigger is a **REST Hook** with three functions:

```js
// triggers/lead_connected.js  (one file per event_type)
const BASE = 'https://syndie.io/api/integrations/automation/zapier';

const subscribeHook = (z, bundle) =>
  z.request({
    method: 'POST',
    url: `${BASE}/hooks/subscribe`,
    body: {
      target_url: bundle.targetUrl,        // Zapier provides this
      event_type: 'lead_connected',        // matches backend eventType strings
      automation_name: bundle.inputData.zapName || 'Zapier Zap',
    },
  }).then((res) => res.data);              // backend returns { id, webhook }

const unsubscribeHook = (z, bundle) =>
  z.request({
    method: 'DELETE',
    url: `${BASE}/hooks/${bundle.subscribeData.id}`,   // id from subscribe response
  }).then((res) => res.data);

const parsePayload = (z, bundle) => [bundle.cleanedRequest];  // inbound event → items

const sampleList = (z, bundle) =>          // backend route is /hooks/recent
  z.request({ url: `${BASE}/hooks/recent` }).then((res) => res.data);

module.exports = {
  key: 'lead_connected',
  noun: 'Lead',
  display: { label: 'Lead Connected', description: 'Triggers when a lead connects.' },
  operation: {
    type: 'hook',
    performSubscribe: subscribeHook,
    performUnsubscribe: unsubscribeHook,
    perform: parsePayload,
    performList: sampleList,               // required for sample data
    sample: { /* one representative event — match the LIVE payload, see n8n doc §4b */ },
    outputFields: [ /* field hints for the mapper */ ],
  },
};
```

> Note: the backend currently stores whatever `event_type` you send (free-form),
> and `campaign-engine` decides what actually fires. Until per-event dispatch
> exists, every trigger effectively receives the same stream — coordinate the
> `eventType` values end-to-end before shipping multiple triggers.

Repeat for each event type. Register them in `index.js`.

### Step 3 — Verify signatures (if implemented)
In `perform`, validate the HMAC header before returning items; throw on mismatch.

### Step 4 — Test, push, invite
```bash
zapier test          # unit tests
zapier push          # upload a private version
zapier invite        # share with testers
```

### Step 5 — Submit for public listing (optional)
- Provide branding, descriptions, and at least the required triggers/actions.
- Go through Zapier's app review to appear in the public directory.

---

## 4. Optional: Actions, not just triggers

The n8n node is trigger-only. On Zapier you could also add **Actions** (Zapier →
Syndie), e.g. "Add Lead to Campaign," "Send Message." Each is a `creates/*.js`
that POSTs to your api engine. Plan these once the triggers are stable.

---

## 5. Suggested sequencing

1. Backend config only: set `ZAPIER_CLIENT_ID` + register Zapier's redirect URI.
   (Endpoints already exist — no new backend code.)
2. Zapier: auth → one trigger end-to-end (`lead_connected`) → verify the loop
   using `POST /zapier/trigger` to send a test event.
3. Align live payload shape (n8n doc §4b) so the trigger `sample` is accurate.
4. Add remaining triggers (only once `campaign-engine` dispatches distinct
   `eventType`s — otherwise ship one catch-all trigger).
5. (Optional) Actions, then submit for public review.

> Parallel quick win: backfill the existing `DELETE /n8n/hooks/:id` into the
> **n8n** node's `delete` method so it stops leaking subscriptions.

---

## 6. Effort estimate (rough)

| Phase                                        | Effort      |
| -------------------------------------------- | ----------- |
| Backend config (`ZAPIER_CLIENT_ID` + URI)    | ~0.5 day    |
| Zapier auth (OAuth2/PKCE) against existing API| 0.5 day    |
| First trigger end-to-end                     | 0.5–1 day   |
| Payload alignment + remaining triggers       | ~0.5 day ea |
| Polish + tests + submission                  | 1–2 days    |

*(No multi-day backend build — the original estimate assumed endpoints didn't
exist. They do.)*
