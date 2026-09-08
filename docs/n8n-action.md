# Syndie action — how it works

The reference for `nodes/Syndie/Syndie.node.ts`: Resource **Lead**, operations
**Import** and **Find**. Both use the same credential as the
[trigger](./n8n-trigger.md) and answer in the same `lead` shape the trigger
delivers, so one set of field mappings serves both.

---

## 1. Import (operation value `create`)

Adds a person as a contact in the connected workspace, **without duplicates**:
the backend matches by LinkedIn public identifier first, then by email, inside
the workspace, and returns the existing contact when there is one.

| Parameter | Notes |
|---|---|
| **LinkedIn URL** | Full address or just the public identifier after `/in/`. Any spelling — with or without `https`, `www.`, a trailing slash, mixed case. |
| **Email** | Matched case-insensitively. |
| Additional Fields | Company · First Name · Job Title (stored as the headline) · Last Name · Location · Phone · Public Identifier |

At least one of LinkedIn URL, Public Identifier or Email is required; otherwise
the item fails before any request with "Give a LinkedIn URL, a public identifier
or an email so the lead can be matched".

**Request:** `POST <base>/api/integrations/automation/n8n/actions/import-lead`

```json
{ "linkedinUrl": "https://www.linkedin.com/in/sarah-green", "email": "sarah@kestrel.io",
  "firstName": "Sarah", "lastName": "Green", "jobTitle": "Head of Talent",
  "company": "Kestrel", "location": "Berlin, Germany", "phone": "+49 30 1234567" }
```

Only filled-in fields are sent. **Response** (`200`):

```json
{ "created": true,
  "lead": { "id": "…", "firstName": "Sarah", "lastName": "Green", "headline": "Head of Talent",
            "company": "Kestrel", "location": "Berlin, Germany", "email": "sarah@kestrel.io",
            "phone": "+49 30 1234567", "publicIdentifier": "sarah-green",
            "linkedinUrl": "https://www.linkedin.com/in/sarah-green",
            "connectionStatus": "not_connected", "campaignId": null } }
```

`created: false` means the person was already there and `lead` is that contact.
A new contact carries no campaign and starts as `not_connected`.

The route is also reachable as `…/actions/create-lead`, the name 0.3.x used.

## 2. Find (operation value `find`)

| Parameter | Notes |
|---|---|
| **LinkedIn URL** | Address or public identifier. |
| **Email** | — |

One of the two is required. **Request:**
`GET <base>/api/integrations/automation/n8n/actions/find-lead?linkedin=<…>&email=<…>`

**Response** (`200`): `{ "found": true, "lead": { … } }` or
`{ "found": false, "lead": null }`. Not found is a normal item, not an error, so
an IF node can branch on `found` — pair Find with Import for "find or create".

---

## 3. Errors

Errors come in the backend's envelope; the node surfaces the message and the
item index. Switch on `code` if you handle them in an expression.

| Status | `code` | Meaning |
|---|---|---|
| 400 | `LEAD_IDENTITY_REQUIRED` | nothing to match on (the node normally catches this first) |
| 401 | `AUTOMATION_ACCESS_TOKEN_INVALID` / `_EXPIRED` | reconnect the credential (n8n refreshes automatically first) |
| 403 | `AUTOMATION_NOT_AVAILABLE_FOR_WORKSPACE` | the workspace is not eligible for this connector |

With **Continue On Fail** a failing item becomes `{ "error": "…" }` and the run
goes on; without it the run stops with a `NodeApiError` naming the item.

---

## 4. Compatibility with 0.3.x workflows

- The Import operation keeps the stored value `create`; only the label changed.
- A LinkedIn URL saved under *Additional Fields* by 0.3.x is still read.
- The old *Connection Status* field is ignored; `automationId` is no longer sent
  (the backend never read it).
