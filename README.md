# Syndie for n8n

Connect [Syndie](https://syndie.io) to your n8n workflows. One credential, two
nodes:

- **Syndie Trigger** — starts a workflow when something happens to a lead in
  Syndie. Six events, delivered signed, within seconds.
- **Syndie** — an action node. **Import a lead** into Syndie without creating
  duplicates, or **find a lead** by LinkedIn address or email.

Available to Syndie workspaces. Installs from the n8n nodes panel (it is a
verified community node) on n8n Cloud and on self-hosted n8n.

---

## Installation

In n8n: **Settings → Community Nodes → Install** and enter:

```
@syndie/n8n-nodes-syndie
```

Self-hosted instances need `N8N_COMMUNITY_PACKAGES_ENABLED=true` unless the
package is installed from the in-app nodes panel.

> Building from source or contributing? See [CONTRIBUTING.md](./CONTRIBUTING.md)
> for the dev loop and [ARCHITECTURE.md](./ARCHITECTURE.md) for how the pieces
> fit together.

---

## Credentials

Both nodes use one **Syndie OAuth2 API** credential.

| Field | What to enter |
|---|---|
| **Client ID** | The Client ID Syndie issued for n8n. Ask Syndie support if you do not have it. |
| **Client Secret** | Any value. Syndie does not use a secret for n8n (the connection is protected by PKCE); n8n requires the field to be filled. |
| **API Base URL** | Leave the default, `https://api.syndie.io`, unless Syndie support gave you another address. |

Click **Connect**, sign in to Syndie, and approve. Your n8n must be reachable over
**https**: Syndie sends events to it and only registers https addresses.

---

## Syndie Trigger

1. Add **Syndie Trigger**, select the credential.
2. Choose the **Events** that should start the workflow. All six are selected by
   default; a subset is fine.
3. **Activate** the workflow. Syndie registers n8n's webhook address for you;
   there is no URL to copy.

| Event | Fires when |
|---|---|
| Lead Replied | a lead answers on LinkedIn or by email |
| Connection Accepted | a lead accepts the connection request |
| Status Changed | somebody changes a lead's status in Syndie |
| Lead Opted Out | the lead asks to stop, complains, or is blocked by hand |
| Conversation Handed Off | the AI SDR hands the conversation to a person |
| Meeting Booked | the lead books a meeting |

Each delivery is one item with a plain JSON body: `id`, `event`, `occurredAt`,
`workspaceId`, `lead { … }`, `campaign { … } | null`, plus one block for the
event (`reply`, `status`, `optOut`, `handoff` or `meeting`). Use `id` to ignore
a repeat. Full shapes: [docs/n8n-trigger.md](./docs/n8n-trigger.md).

**Every delivery is signed.** The node checks the signature against the secret
Syndie handed it when it subscribed, and answers `401` to anything else, so a
stranger who learns your webhook address cannot start your workflow.

---

## Syndie (action)

**Import** adds a lead as a contact. Give a **LinkedIn URL** (or public
identifier) and/or an **Email**; name, job title, company, location and phone
are optional. If Syndie already has that person, the existing contact comes
back with `created: false` instead of a duplicate. Imported contacts carry no
campaign and start as not connected.

**Find** looks a lead up by LinkedIn URL or email. Not found is a normal answer
(`found: false`), so a workflow can branch on it — pair Find with Import for
"find or create".

Request and response shapes: [docs/n8n-action.md](./docs/n8n-action.md).

---

## Upgrading from 0.3.x

- **Re-activate each workflow that uses the trigger** (deactivate, activate).
  Until you do, its deliveries are accepted without a signature check, and n8n
  logs a warning on each one. After re-activation the check is on.
- The action's **Create** operation is now **Import**. Saved workflows keep
  working; a LinkedIn URL left under *Additional Fields* is still read. The old
  *Connection Status* field is ignored.
- Subscriptions made by 0.3.x receive **every** event, which is also what the new
  default does.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Connect fails with "not available for your workspace" | the workspace is not eligible for this connector | contact Syndie support |
| Connect fails with a client id error | wrong Client ID | use the one Syndie issued |
| Activation fails: "must be reachable over https" | n8n advertises an http or localhost address | set `WEBHOOK_URL` to your public https address and restart n8n |
| Nothing arrives after activation | the workflow was activated before Syndie had events, or no event has happened yet | re-activate, then change a lead's status in Syndie |
| n8n logs "deliveries are not signed" | activated on 0.3.x | re-activate the workflow |
| Deliveries answered 401 | a delivery from something other than Syndie, or a stale subscription | re-activate the workflow; if it persists, contact support |

---

## License

[MIT](./LICENSE.md)

## Support

[support@syndie.io](mailto:support@syndie.io)
