# Syndie n8n Trigger — How It Works

A readable, plain-English reference for the `SyndieTrigger` node and the backend
contract it depends on.

> Source files:
> - Node: `nodes/Syndie/SyndieTrigger.node.ts`
> - Credential: `credentials/SyndieOAuth2Api.credentials.ts`

---

## 1. The one-line summary

The Syndie node is a **webhook trigger**: when an n8n workflow is activated, the
node tells the Syndie backend "send my events to this URL." Syndie then pushes
events to that URL, and each event starts one run of the workflow.

```
n8n workflow activated
        │
        ▼
  [create] POST target_url ──────────────►  Syndie backend
        │      (OAuth2-authenticated)        (api engine)
        │                                          │
        │   ... later, when something happens ...  │
        ▼                                          ▼
  [webhook] receives event  ◄──────────────  POST event JSON
        │
        ▼
  emits JSON into the workflow → next node runs
```

---

## 2. What it authenticates with

Credential type: **`syndieOAuth2Api`** — extends n8n's built-in `oAuth2Api`.

| Setting            | Value                                                                 |
| ------------------ | --------------------------------------------------------------------- |
| Grant type         | Authorization Code **with PKCE** (public client, no secret)           |
| Client ID          | Provided by Syndie, entered by the user                               |
| Authorization URL  | `https://syndie.io/api/integrations/automation/n8n/oauth/authorize`   |
| Access Token URL   | `https://syndie.io/api/integrations/automation/n8n/oauth/callback`    |
| Token placement    | `Authorization` header                                                |
| Refresh behavior   | Re-sends credentials on refresh (`includeCredentialsOnRefresh: true`) |

n8n drives the whole OAuth dance; the node just reuses the resulting token when
it calls the backend.

---

## 3. The lifecycle (what runs, and when)

The node implements n8n's webhook lifecycle methods.

### a) `create` — runs when the workflow is activated / node is test-executed
- n8n generates a public webhook URL for this node.
- The node POSTs that URL to the **Backend URL** (default:
  `https://syndie.io/api/integrations/automation/n8n/hooks/subscribe`),
  authenticated with the OAuth2 credential.
- **Request body:**

  ```json
  {
    "automation_name": "<workflow name, or n8n-workflow-<id>>",
    "automation_id":   "<n8n workflow id>",
    "event_type":      null,
    "target_url":      "<the n8n webhook URL Syndie should call>"
  }
  ```

- On HTTP error → throws `NodeApiError` (status + response body).
- On any other error → throws `NodeOperationError`.

### b) `webhook` — runs every time Syndie delivers an event
- Reads the POST body.
- Emits it unchanged as the workflow's first item:

  ```json
  { "json": <the entire request body Syndie sent> }
  ```

- No filtering, no field mapping, no signature verification.

### c) `checkExists` — currently always returns `false`
- Meaning: n8n thinks the webhook never exists, so `create` runs on **every**
  activation. Your backend must deduplicate registrations.

### d) `delete` — currently a no-op (returns `true`)
- Deactivating the workflow does **not** tell Syndie to stop sending. The
  backend keeps the (now-dead) `target_url`.

---

## 4. The events / "tasks" (confirmed from the backend)

> Backend: `api-engine` (NestJS). Relevant files:
> `src/modules/integrations/services/automation.service.ts`,
> `controllers/automation.controller.ts`, `prisma/schema.prisma`.

### How the backend stores the subscription
When the node calls `/n8n/hooks/subscribe`, the backend creates an
`AutomationWebhook` row:

| Field            | Value sent by this node          | Note                                            |
| ---------------- | -------------------------------- | ----------------------------------------------- |
| `eventType`      | `null` → stored as **`default`** | `event_type ?? 'default'` (automation.service)  |
| `automationId`   | n8n workflow id                  |                                                 |
| `automationName` | workflow name                    | used by the "Test connection" button           |
| `targetUrl`      | n8n webhook URL                  | where events are POSTed                          |
| `automationType` | `n8n`                            | enum: `zapier \| make \| n8n \| slack`          |
| `isActive`       | `true`                           |                                                 |

### What "tasks" actually exist
`eventType` is a **free-form string**, not a fixed enum. The schema documents
these example values:

| `eventType`          | Fires when…                          |
| -------------------- | ------------------------------------ |
| `default`            | what THIS node registers — any event |
| `lead_connected`     | a lead accepts / connects            |
| `campaign_completed` | a campaign finishes                  |

Because this node always sends `event_type: null` (→ `default`), **it currently
subscribes to the catch-all stream**, not to a specific task. To support
`lead_connected` vs `campaign_completed` as distinct triggers, expose
`event_type` as a node dropdown and pass it in the subscribe body.

### Who actually fires the events (important)
`api-engine` only **manages** subscriptions and sends a **synthetic test**
payload (`sendTestTrigger`). The **real** events are dispatched by a separate
repo, **`campaign-engine`**, when a lead reaches a flow step:

- Flow step **"Trigger N8n"** (`trigger_n8n`) → OAuth path → this node.
- Flow step **"Notify Webhook"** (`notify_webhook`) → plain pasted-URL path
  (the generic n8n Webhook node, documented in `content/docs/webhook-n8n.mdx`).

So a Syndie event = "a lead hit a Trigger-N8n / Notify-Webhook step in an active
campaign flow," not a fixed system event.

---

## 4b. Payload shapes (what your workflow receives)

There are **three different shapes** in play today — worth normalizing.

**1. Real campaign event** (from `campaign-engine`, per `webhook-n8n.mdx`):
```json
{
  "id": "lead-id-123",
  "firstName": "John", "lastName": "Doe",
  "linkedinUrl": "https://linkedin.com/in/johndoe",
  "connectionStatus": "connected", "customStatus": "interested",
  "location": "New York, USA", "jobtitle": "Marketing Director",
  "email": "john@example.com", "createdAt": "2026-01-15T10:30:00Z",
  "steps": [ ... ],
  "campaign": {
    "id": "campaign-id-456", "name": "Outreach Q1", "status": "active",
    "seat": { "firstName": "Your", "lastName": "Name", "accountType": "linkedin" },
    "leadList": { "name": "Tech Leaders", "listType": "search" }
  }
}
```

**2. Test trigger** (`POST /n8n/trigger`, `sendTestTrigger`) — *different shape*:
```json
{ "lead": { "firstName": "John", "lastName": "Doe", "email": "...",
            "headline": "CEO at Example Inc.", "location": "...", "company": "..." },
  "timestamp": "..." }
```

**3. `hooks/recent` sample** (`listRecent`, for Zapier `performList`) — flat lead
objects with `phoneNumber`, `jobtitle`, etc.

> ⚠️ Shapes 1 and 2 disagree (`firstName` at top level vs nested under `lead`).
> A workflow mapped against the test payload will break on real events. Aligning
> these is a backend (`campaign-engine` / `automation.service`) fix.

---

## 5. Known gaps / cleanup candidates

1. **Manifest path mismatch** — `package.json` registers
   `dist/nodes/Syndie/Syndie.node.js`, but the source compiles to
   `SyndieTrigger.node.js`. After a build n8n looks for a file that isn't there.
2. **No `event_type` selection** — every workflow gets the `default` stream (§4).
3. **`delete` never unsubscribes — but the backend endpoint EXISTS.** The backend
   already implements `DELETE /n8n/hooks/:webhookId` (`automation.service.ts`
   `unsubscribe`), which flips `isActive: false`. The node's `delete` just
   `return true`s instead of calling it, so deactivating a workflow leaves a live
   subscription. Easy fix: capture the `id` returned by `subscribe` and DELETE it
   in `delete`.
4. **`checkExists` always false** — re-registers on every activation. The backend
   dedupes (it looks up an existing identical row and returns it), so this is
   tolerable but wasteful.
5. **No payload signature verification** — the `webhook` handler trusts any POST
   to the URL. The backend doesn't sign outbound events yet either; adding an
   HMAC header on both sides would close this.
6. **Payload shape mismatch** — real vs test payloads differ (§4b).
7. **`index.js` is empty** — harmless (n8n loads via the `n8n` manifest), but
   worth noting.
