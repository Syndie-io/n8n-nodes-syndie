# Testing the Syndie nodes on a self-hosted n8n

This guide walks through running the Syndie **Trigger** and **Action** nodes
end-to-end against a Syndie backend (Beta/Staging or Production) from a
self-hosted n8n instance.

## Why self-hosting is needed

The Syndie trigger is a **reverse webhook**: on activation it registers n8n's
webhook URL with the Syndie backend, and the backend (hosted on AWS) later POSTs
events to that URL. For that to work, **n8n must be reachable from the public
internet** — a laptop on `localhost:5678` is not. Two ways to get a public URL:

| Route | Effort | Best for |
| ----- | ------ | -------- |
| **A. VPS + Docker** (public domain + HTTPS) | ~30–60 min | A stable setup you configure once; production-like |
| **B. Tunnel** (Cloudflare Tunnel / ngrok) | ~10 min | A quick one-off test from your local machine |

Either way, the single most important setting is **`WEBHOOK_URL`** — without it,
n8n advertises `http://localhost:5678/...` to the backend even through a tunnel,
and delivery fails.

---

## Prerequisites

- A Syndie **Client ID** for the environment you're testing (Beta or Production).
- The ability to **allowlist an OAuth redirect URI** on the Syndie backend (see
  step 4) — this is required for the OAuth "Connect" to succeed.
- Docker (Route A) or a Cloudflare/ngrok account (Route B).

---

## Route A — VPS + Docker (recommended)

### 1. Provision and point a domain
- Create a small VPS (DigitalOcean / Hetzner / Railway). 1 vCPU / 1–2 GB is enough.
- Point a subdomain at it, e.g. `n8n.yourdomain.com` (A record → server IP).

### 2. Run n8n with the public URL baked in
`docker-compose.yml`:

```yaml
services:
  n8n:
    image: n8nio/n8n:latest
    restart: unless-stopped
    environment:
      - N8N_HOST=n8n.yourdomain.com
      - N8N_PROTOCOL=https
      - WEBHOOK_URL=https://n8n.yourdomain.com/        # critical
      - N8N_PORT=5678
      - N8N_COMMUNITY_PACKAGES_ENABLED=true            # allow installing this node
    ports: ["5678:5678"]
    volumes: ["n8n_data:/home/node/.n8n"]
volumes: { n8n_data: {} }
```

Put TLS in front with **Caddy** (auto Let's Encrypt) reverse-proxying
`n8n.yourdomain.com → localhost:5678`, or use a platform that terminates HTTPS
for you (Railway/Render — then set `WEBHOOK_URL` to that https URL).

Go to step 3.

---

## Route B — Tunnel + local n8n (quick test)

Cloudflare Tunnel is steadier than ngrok-free (stable URL, no interstitial), but
either works. Using ngrok as the example:

### 1. Start the tunnel
```bash
# claim a free static domain in the ngrok dashboard first, so the URL is stable
ngrok http --domain=YOUR-STATIC.ngrok-free.app 5678
```

### 2. Restart n8n with the public URL (PowerShell, same window before launching)
```powershell
$env:N8N_HOST="YOUR-STATIC.ngrok-free.app"
$env:N8N_PROTOCOL="https"
$env:WEBHOOK_URL="https://YOUR-STATIC.ngrok-free.app/"
$env:N8N_COMMUNITY_PACKAGES_ENABLED="true"
n8n start
```
(macOS/Linux: `export N8N_HOST=...` etc.) After boot, the n8n log should show the
editor/webhook URL as your public domain, **not** `localhost`. If it still says
localhost, `WEBHOOK_URL` didn't take — fix that before continuing.

---

## 3. Install the Syndie node

**Published (recommended):** n8n → **Settings → Community Nodes → Install** →
enter `@syndie/n8n-nodes-syndie` → Install. Both **Syndie Trigger** and **Syndie**
appear in the nodes panel.

**Local/unpublished (dev):** build and mount the package:
```bash
# in this repo
pnpm install && pnpm build
# point n8n at the build (one option):
#   N8N_CUSTOM_EXTENSIONS=/path/to/n8n-nodes-syndie/dist
# or `npm link` it into ~/.n8n/custom (see README "Local development")
```

## 4. Configure the credential + allowlist the redirect URI

1. Add a **Syndie OAuth2 API** credential. Set **Environment** (Beta or
   Production) and paste your **Client ID**.
2. **Backend prerequisite:** n8n's OAuth redirect URI is
   `https://<your-n8n-host>/rest/oauth2-credential/callback`. This **exact** URI
   must be allowlisted for the Syndie n8n OAuth client (`N8N_CLIENT_ID`,
   handled by the backend's `automation-oauth.controller.ts`). With a stable
   domain you do this once.
3. Click **Connect** and complete the PKCE flow. Success = a green "Connected".

---

## 5. Test the TRIGGER (Syndie → n8n)

1. Add a **Syndie Trigger** node, select the credential, **Activate** the
   workflow. Activation registers the production webhook URL
   (`https://<host>/webhook/<id>/webhook`) with the backend.
2. Confirm registration: the backend should now have an `AutomationWebhook` row
   whose `targetUrl` is your **https** domain (check via the backend
   `GET /n8n/hooks/recent`, or the DB).
3. Fire a test event from the backend's Swagger
   (`POST /api/integrations/automation/n8n/trigger`) with a JSON body:
   ```json
   { "automation_name": "<your workflow name>", "clerkUserId": "<your user id>" }
   ```
4. **Verify:** the n8n **Executions** tab shows a new run whose first item is the
   sample-lead JSON.

> Use the **production** `/webhook/` URL (workflow Active) — not the editor's
> `/webhook-test/` URL, which only fires while you're actively listening.

## 6. Test the ACTION (n8n → Syndie)

1. Add a **Syndie** node → Resource **Lead**, Operation **Create**.
2. Set **Campaign ID** to a campaign your account owns, and add a few
   **Additional Fields** (first name, last name, job title, …).
3. **Execute** the node.
4. **Verify:** the node returns
   `{ "message": "Lead created successfully.", "lead": { … } }`, and a new lead
   appears under that campaign in Syndie.

You can wire **Trigger → Syndie (Create Lead)** in one workflow to confirm the
round-trip — the action's field names match the trigger's output keys.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| ------- | ------------ | --- |
| Trigger never fires; backend delivery fails | `targetUrl` registered as `localhost` | Set `WEBHOOK_URL` to the public domain, restart n8n, re-activate |
| OAuth "Connect" fails / redirect rejected | Redirect URI not allowlisted backend-side | Allowlist `https://<host>/rest/oauth2-credential/callback` (step 4) |
| Test event 400 "Missing automationName" | Empty Swagger body | Send the JSON body in step 5.3 (or call via curl) |
| Action returns `404 Campaign` | Campaign id wrong or not owned by the connected user | Use a campaign id from the same Syndie account |
| Node not visible after install | Community packages disabled, or build not mounted | Set `N8N_COMMUNITY_PACKAGES_ENABLED=true`; for dev, point `N8N_CUSTOM_EXTENSIONS` at `dist/` |
| Tunnel URL changed | ngrok-free rotates URLs on restart | Use a static domain (ngrok) or a named Cloudflare Tunnel; then re-activate |
