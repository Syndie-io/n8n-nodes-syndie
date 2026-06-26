# Syndie n8n Action — How It Works

A plain-English reference for the **Syndie** action node (`Syndie.node.ts`) — the
counterpart to the [trigger](./n8n-trigger.md). Where the trigger pushes Syndie
events *out* to n8n, this node pushes data *into* Syndie.

> Source files:
> - Node: `nodes/Syndie/Syndie.node.ts`
> - Credential: `credentials/SyndieOAuth2Api.credentials.ts` (shared with the trigger)

---

## 1. The one-line summary

The Syndie action node takes an incoming n8n item and **creates a lead in the
connected Syndie account** by calling the backend's create-lead endpoint,
authenticated with the same OAuth2 credential the trigger uses.

```
[previous node] → [Syndie: Lead → Create] ──POST──► Syndie backend
                        │     (OAuth2-authenticated)        │
                        │                                   ▼
                        │                          creates a Lead owned by the
                        ▼                          connected user, tagged with
                  emits the created lead JSON      the source automationId
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
| **Additional Fields** (collection) | — | `firstName`, `lastName`, `jobTitle` (→ stored as `headline`), `company`, `location`, `linkedinUrl`, `publicIdentifier`, `connectionStatus`. All optional. |

There are no other parameters: the endpoint is fixed to the Syndie production API
(no campaign id, no environment selector, no URL override). Empty optional fields
are dropped from the request body, so only the values you actually set are sent.

> **Note:** Campaign ID used to be a required parameter. It was removed in 0.2.x —
> leads are now created against the connected account and associated with the
> source automation, not a specific campaign.

---

## 4. The backend contract

`POST https://api.syndie.io/api/integrations/automation/n8n/actions/create-lead`

The base URL is hardcoded to production (`SYNDIE_API_BASE_URL`, defined once in
`credentials/SyndieOAuth2Api.credentials.ts` and imported by the node). The
endpoint itself is **provider-agnostic** — the same route serves `zapier`, `n8n`,
and `make` (the provider is the `:provider` path segment).

**Request body** (the keys mirror the canonical trigger payload, so a trigger →
action round-trip maps 1:1). `automationId` is added automatically — it is the id
of the n8n workflow this node runs in, so created leads can be traced back to
their source automation:

```json
{
  "automationId": "42",
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
2. Parses `publicIdentifier` from `linkedinUrl` when not given explicitly.
3. Creates the `Lead` for that user (denormalized fields; `connectionStatus`
   defaults to `pending`; empty `steps`/`executions`), tagged with `automationId`.
4. Returns the lead in the canonical `LeadTriggerPayload` shape.

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
  status and response body (e.g. `401` when the OAuth token is invalid/expired).

---

## 6. Known gaps / cleanup candidates

1. **`email` / `phoneNumber` are not sent.** The Syndie `Lead` table has no
   column for them (they live on the related `LinkedinProfile`), so they're
   intentionally omitted rather than silently dropped. Supporting them needs a
   profile row or a new Lead column on the backend.
2. **Leads are created with empty `steps`.** The `campaign-engine` (separate
   repo) drives outreach flow; a lead added via this action won't auto-run
   unless that engine picks it up. Confirm the intended lifecycle backend-side.
