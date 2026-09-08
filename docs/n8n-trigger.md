# Syndie Trigger — how it works

The reference for `nodes/Syndie/SyndieTrigger.node.ts` and the backend contract
it relies on. Shared helpers live in `nodes/Syndie/GenericFunctions.ts`. For the
action node see [n8n-action.md](./n8n-action.md).

---

## 1. In one line

When a workflow is activated, the trigger asks the Syndie backend to send chosen
events to n8n's webhook address. The backend writes every event to an outbox and
delivers it, signed, within seconds; each accepted delivery starts one run.

```
activate ──► POST hooks/subscribe (one per event, or one "default")
                    │   answers { id, signing_secret, … } → remembered
                    ▼
    … something happens to a lead …
                    ▼
      backend POSTs the event, signed ──► webhook(): check → one item
deactivate ──► DELETE hooks/<id> for every remembered subscription
```

---

## 2. Authentication

Credential `syndieOAuth2Api`, which extends n8n's `oAuth2Api`.

| Setting | Value |
|---|---|
| Grant | Authorization Code with PKCE |
| Client ID | issued by Syndie, entered by the user |
| API Base URL | visible field, default `https://api.syndie.io` |
| Authorization URL | `<base>/api/integrations/automation/n8n/oauth/authorize` |
| Access Token URL | `<base>/api/integrations/automation/n8n/oauth/token` (both grants) |
| Token placement | `Authorization: Bearer` header |

n8n's redirect address `https://<n8n-host>/rest/oauth2-credential/callback` is
accepted by the backend for any https host (and plain http only on localhost),
so nothing has to be allow-listed per instance. A workspace that is not eligible
for the connector is refused at authorize with `403
AUTOMATION_NOT_AVAILABLE_FOR_WORKSPACE`.

---

## 3. Lifecycle

### `create` — on activation
1. Reads the **Events** setting. All six selected → one subscription with
   `event_type: "default"` (the backend's "every event"; also what 0.3.x sent). A
   subset → one subscription per event.
2. For each, `POST <base>/api/integrations/automation/n8n/hooks/subscribe` with
   ```json
   { "automation_name": "<workflow name>", "automation_id": "<workflow id>",
     "event_type": "lead.replied", "target_url": "<n8n webhook URL>" }
   ```
   and remembers the reply's `id` and `signing_secret` in the node's static data:
   ```json
   { "subscriptions": [ { "webhookId": "…", "event": "lead.replied",
                           "targetUrl": "https://…/webhook/…", "signingSecret": "…" } ] }
   ```
3. If any subscribe fails, the ones already made are removed again and one
   `NodeApiError` is raised, so a half-subscribed workflow cannot exist.
4. The backend refuses an `http` or private `target_url`
   (`400 AUTOMATION_TARGET_URL_INVALID`) and an unknown event name
   (`400 AUTOMATION_EVENT_TYPE_UNSUPPORTED`). Re-subscribing the same URL and
   event returns the same subscription and secret.

### `webhook` — on every delivery
1. Reads `X-Webhook-Subscription-Id` and matches it to a remembered subscription.
2. Verifies `X-Webhook-Signature` over the raw request bytes (§5).
3. Refuses with `401 { "error": "Delivery refused: …" }` — and no workflow run —
   when the signature does not match, the stamp is stale or missing, the
   subscription id is unknown or missing, or the workflow holds nothing.
4. Otherwise emits the body as one item.

**Upgrade exception:** a workflow activated on 0.3.x holds a subscription id and
no secret (none existed then). Its deliveries are let through and a warning is
logged asking for a re-activation. Once any secret is on record the exception
closes.

### `checkExists` — always `false`
The backend deduplicates, so `create` simply runs on every activation.

### `delete` — on deactivation
`DELETE <base>/api/integrations/automation/n8n/hooks/<id>` for every remembered
subscription. `404` counts as removed. A failure keeps that subscription on record
and raises one error, so the next deactivation retries exactly those.

---

## 4. Events and payload

| `event` | Extra block |
|---|---|
| `lead.replied` | `reply { channel: "linkedin" \| "email", message, at, subject? }` |
| `lead.connection_accepted` | — |
| `lead.status_changed` | `status { from, to }` |
| `lead.opted_out` | `optOut { reason: replied_opt_out \| unsubscribe_link \| complaint \| blacklisted, email? }` |
| `conversation.handed_off` | `handoff { reason }` |
| `meeting.booked` | `meeting { startAt, meetLink, inviteeEmail }` |

Every delivery:

```json
{
  "id": "replied:64f1…:linkedin:1757323800",
  "event": "lead.replied",
  "occurredAt": "2026-09-08T09:30:00.000Z",
  "workspaceId": "64f1c0a2b3c4d5e6f7a8b9c2",
  "lead": {
    "id": "64f1c0a2b3c4d5e6f7a8b9c0",
    "firstName": "Sarah", "lastName": "Green",
    "headline": "Head of Growth at Example Inc.",
    "company": "Example Inc.", "location": "Austin, Texas",
    "email": "sarah.green@example.com", "phone": null,
    "publicIdentifier": "sarah-green",
    "linkedinUrl": "https://www.linkedin.com/in/sarah-green",
    "connectionStatus": "accepted",
    "campaignId": "64f1c0a2b3c4d5e6f7a8b9c1"
  },
  "campaign": { "id": "64f1c0a2b3c4d5e6f7a8b9c1", "name": "Q3 outreach" },
  "reply": { "channel": "linkedin", "message": "Thanks — happy to hear more next week.", "at": "2026-09-08T09:30:00.000Z" }
}
```

`campaign` is `null` for a contact outside any campaign. `id` is stable per
event, so a repeat delivery (a retry after a timeout, say) carries the same `id`.
`GET <base>/api/integrations/automation/n8n/hooks/recent?event_type=<name>`
returns a sample in exactly this shape.

---

## 5. Signature

Headers on every delivery:

| Header | Value |
|---|---|
| `X-Webhook-Signature` | `t=<unix seconds>,v1=<hex>` (a second `v1` may appear while a secret rotates) |
| `X-Webhook-Subscription-Id` | the subscription the event belongs to |
| `X-Webhook-Event-Id` | same as the body's `id` |
| `User-Agent` | `Automation-Webhooks/1` |

`v1 = HMAC-SHA256(secret, "<t>." + raw body)`. The node compares in constant
time against the raw bytes n8n received (`req.rawBody`), and refuses a `t` more
than five minutes from now. `scripts/self-test.mjs` exercises every branch.

---

## 6. Delivery guarantees (backend side)

- Written to an outbox first; a worker delivers every 5 s.
- Failed POSTs retry after 1 min, 5 min, 30 min, 2 h and 12 h (six attempts).
- A `410` from n8n switches the subscription off; so do ten consecutive
  failures. Deactivate and re-activate the workflow to subscribe again.
- Deliveries are kept 30 days for inspection on the backend.
