# Testing the Syndie nodes end to end

Two layers of testing exist. The first needs nothing but this repository; the
second needs a publicly reachable n8n and a Syndie backend.

## 1. Without n8n: the self-test

```bash
pnpm install && pnpm build && pnpm test
```

`scripts/self-test.mjs` loads `dist/` the way n8n would and drives both nodes
with a stubbed n8n context: activation and deactivation, every delivery outcome
(signed, tampered, stale, unknown subscription, 0.3.x pass-through), the action's
requests, the credential's defaults. 56 checks, about a second, no network. CI
runs it after every build.

## 2. With n8n: a real round trip

### Why n8n must be public

The trigger is a reverse webhook: on activation it registers n8n's webhook
address with the backend, and the backend POSTs events to it. `localhost:5678`
cannot receive those, and the backend refuses to register anything but a public
**https** address. The setting that matters is `WEBHOOK_URL`; without it n8n
advertises `http://localhost:5678/…` even through a tunnel.

### Run n8n with the unpublished build

```bash
pnpm build
docker run --rm -p 5678:5678 \
  -e N8N_HOST=YOUR-HOST -e N8N_PROTOCOL=https \
  -e WEBHOOK_URL=https://YOUR-HOST/ -e N8N_EDITOR_BASE_URL=https://YOUR-HOST/ \
  -e N8N_CUSTOM_EXTENSIONS=/data/syndie \
  -v "$PWD/dist:/data/syndie" -v n8n_data:/home/node/.n8n \
  docker.n8n.io/n8nio/n8n
```

Expose port 5678 with a tunnel (`ngrok http --domain=YOUR-HOST 5678`, or a
named Cloudflare Tunnel) or run the container on a host with a real domain and
TLS in front. The n8n log must print your public address, not localhost.

For the published package instead: **Settings → Community Nodes → Install →**
`@syndie/n8n-nodes-syndie` (self-hosted needs
`N8N_COMMUNITY_PACKAGES_ENABLED=true`).

### The credential

Add a **Syndie OAuth2 API** credential:

- **Client ID:** the value of the backend's `N8N_CLIENT_ID` for the environment
  you test against (ask the backend owner; the connector answers `503` while it
  is unset).
- **Client Secret:** anything.
- **API Base URL:** the backend you test against, e.g. `https://dev-api.syndie.io`.
  Leave the default for production.

Click **Connect**. n8n's redirect address
(`https://YOUR-HOST/rest/oauth2-credential/callback`) is accepted for any https
host, so nothing has to be allow-listed. A workspace outside the platform tenant
is refused with `AUTOMATION_NOT_AVAILABLE_FOR_WORKSPACE` — that is expected.

### The trigger

1. Add **Syndie Trigger**, pick two events (say Lead Replied and Status Changed),
   **Activate**. The backend now holds two `AutomationWebhook` rows for your
   workspace, each with a `signingSecret`.
2. In Syndie, change a lead's status. Within a few seconds the **Executions**
   tab shows a run whose item is the `lead.status_changed` payload
   ([shape](./n8n-trigger.md#4-events-and-payload)).
3. Prove the check: send a fake to the webhook address and expect `401`:
   ```bash
   curl -i -X POST https://YOUR-HOST/webhook/<path> -H 'Content-Type: application/json' -d '{"id":"fake"}'
   ```
   Same with a stale stamp or an unknown `X-Webhook-Subscription-Id`.
4. **Deactivate**: the backend rows switch to `isActive: false`.
5. Upgrade path: activate a workflow with the 0.3.2 package, then swap in this
   build and send an event — it is accepted with a warning in the n8n log;
   re-activate and the warning stops.

### The action

1. **Syndie → Lead → Import** with a LinkedIn URL and a name. Execute twice:
   the first answer has `created: true`, the second `created: false` with the
   same `lead.id`, and Syndie's contact list shows one contact.
2. **Syndie → Lead → Find** with an email nobody has: `{ found: false, lead: null }`
   as a normal item.
3. Turn **Continue On Fail** on, set the credential's API Base URL to a wrong
   https host, execute: the item becomes `{ error: … }` and the run finishes.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Activation fails "must start with https://" | API Base URL is http | use https |
| Activation fails `AUTOMATION_TARGET_URL_INVALID` | n8n advertises http/localhost | set `WEBHOOK_URL`, restart, re-activate |
| Connect answers 503 | `N8N_CLIENT_ID` unset on that backend | set it and redeploy |
| Connect answers 403 | workspace not eligible | use a platform workspace |
| Nothing arrives | no event happened, or the backend's worker role is off | change a lead's status; check the backend's `automation.delivery.*` logs |
| Every delivery is 401 | stale subscriptions after a secret change | deactivate and activate |
| Node not visible | `N8N_CUSTOM_EXTENSIONS` not pointing at `dist/`, or community packages disabled | fix the mount or the flag |
