# Syndie n8n Action — How It Works

A plain-English reference for the **Syndie** action node (`Syndie.node.ts`) — the
counterpart to the [trigger](./n8n-trigger.md). Where the trigger pushes Syndie
events *out* to n8n, this node pushes data *into* Syndie.

> Source files:
> - Node: `nodes/Syndie/Syndie.node.ts`
> - Credential: `credentials/SyndieOAuth2Api.credentials.ts` (shared with the trigger)

---

## 1. The one-line summary

The Syndie action node takes an incoming n8n item and **creates a lead in a
Syndie campaign** by calling the backend's create-lead endpoint, authenticated
with the same OAuth2 credential the trigger uses.

```
[previous node] → [Syndie: Lead → Create] ──POST──► Syndie backend
                        │     (OAuth2-authenticated)        │
                        │                                   ▼
                        │                          creates an AutomationWebhook-
                        ▼                          owned Lead under the campaign
                  emits the created lead JSON
```

---

## 2. What it authenticates with

Credential type: **`syndieOAuth2Api`** — identical to the trigger
(Authorization Code + PKCE, token in the `Authorization` header). One credential
powers both nodes.

---

## 3. Node shape

| Field | Value |
| ----- | ----- |
| Display name | **Syndie** |
| Internal name | `syndie` |
| Group | `transform` |
| Inputs / Outputs | Main / Main |
| Resource | **Lead** |
| Operation | **Create** |
| Usable as AI tool | yes (`usableAsTool: true`) |

### Parameters

| Parameter | Required | Notes |
| --------- | -------- | ----- |
| **Campaign ID** | ✅ | The Syndie campaign the lead is added to. Must belong to the connected account. |
| **Additional Fields** (collection) | — | `firstName`, `lastName`, `jobTitle` (→ stored as `headline`), `company`, `location`, `linkedinUrl`, `publicIdentifier`, `connectionStatus`. |
| **Backend URL Override** | — | Full create-lead URL. Leave empty to derive it from the credential's Environment. |

Empty optional fields are dropped from the request body, so only the values you
actually set are sent.

---

## 4. The backend contract

`POST {base}/api/integrations/automation/n8n/actions/create-lead`

The endpoint is **provider-agnostic** — the same route serves `zapier`, `n8n`,
and `make` (the provider is the `:provider` path segment).

**Request body** (mirrors the canonical trigger payload keys so a trigger →
action round-trip maps 1:1):

```json
{
  "campaignId": "60a7b8c9d1e2f3a4b5c6d7e8",
  "firstName": "John",
  "lastName": "Doe",
  "jobTitle": "CEO at Example Inc.",
  "company": "Example Inc.",
  "location": "San Francisco, CA",
  "linkedinUrl": "https://linkedin.com/in/john-doe",
  "publicIdentifier": "john-doe",
  "connectionStatus": "pending"
}
```

**What the backend does** (`automation.service.ts` `createLead`):
1. Validates the OAuth bearer token → resolves the integration's user.
2. Confirms the `campaignId` exists **and belongs to that user** (else `404`).
3. Parses `publicIdentifier` from `linkedinUrl` when not given explicitly.
4. Creates the `Lead` (denormalized fields; `connectionStatus` defaults to
   `pending`; empty `steps`/`executions`).
5. Returns the lead in the canonical `LeadTriggerPayload` shape.

**Response:**
```json
{ "message": "Lead created successfully.", "lead": { /* canonical payload */ } }
```

---

## 5. Behavior notes

- **Per-item:** the node loops over every input item and creates one lead each.
  With **Continue On Fail** enabled, a failing item yields `{ "error": "…" }`
  instead of aborting the run.
- **Errors:** an HTTP error surfaces as a `NodeApiError` carrying the backend's
  status and response body (e.g. `404 Campaign` when the id is wrong or not
  owned by the user).

---

## 6. Known gaps / cleanup candidates

1. **`email` / `phoneNumber` are not sent.** The Syndie `Lead` table has no
   column for them (they live on the related `LinkedinProfile`), so they're
   intentionally omitted rather than silently dropped. Supporting them needs a
   profile row or a new Lead column on the backend.
2. **Campaign ID is free-text.** A `loadOptions` dropdown backed by a
   "list campaigns" endpoint would be friendlier than pasting an ObjectId.
3. **Leads are created with empty `steps`.** The `campaign-engine` (separate
   repo) drives outreach flow; a lead added via this action won't auto-run
   unless that engine picks it up. Confirm the intended lifecycle backend-side.
