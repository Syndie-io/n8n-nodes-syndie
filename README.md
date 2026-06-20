# Syndie n8n Community Node

Connect your n8n workflows to [Syndie.io](https://syndie.io) with OAuth2. This
package provides two nodes that share a single credential:

- **Syndie Trigger** — starts a workflow when Syndie sends an event (a reverse
  webhook: Syndie → n8n).
- **Syndie** — an action node that pushes data *into* Syndie (n8n → Syndie).
  Today it supports **Lead → Create**.

## Features

- Secure OAuth2 authentication (Authorization Code + PKCE)
- Webhook **trigger** for Syndie lead events
- **Action** to create leads in a Syndie campaign
- Provider-agnostic backend (the same API powers Zapier / n8n / Make)
- Usable as AI agent tools (`usableAsTool`)

---

## Installation

In n8n: **Settings → Community Nodes → Install** and enter:

```
@syndie/n8n-nodes-syndie
```

Requires `N8N_COMMUNITY_PACKAGES_ENABLED=true` on self-hosted instances.

### Local development

```bash
pnpm install
pnpm build        # production build into dist/
pnpm dev          # build + watch, links into a local n8n
pnpm lint         # n8n community-node lint
```

To load an unpublished build, point n8n at the build output with
`N8N_CUSTOM_EXTENSIONS=/path/to/n8n-nodes-syndie/dist`, or `npm link` the package
into your n8n custom directory.

---

## Credentials

Both nodes use the **Syndie OAuth2 API** credential.

1. In the credential, set **Environment** — Production (`api.syndie.io`),
   Beta / Staging, Localhost, or Custom (then fill in **Custom Base URL**).
2. Enter the **Client ID** provided by Syndie.
3. Click **Connect** and complete the OAuth2 (PKCE) flow.

The Authorization and Token URLs are derived automatically from the selected
Environment, so the credential always talks to the same Syndie API you connect to.

> **Self-hosted note:** the OAuth redirect URI
> `https://<your-n8n-host>/rest/oauth2-credential/callback` must be allowlisted
> on the Syndie backend, or "Connect" is rejected. See
> [docs/testing-self-hosted.md](./docs/testing-self-hosted.md).

---

## Usage

### Syndie Trigger

1. Add the **Syndie Trigger** node and select the credential.
2. **Activate** the workflow — this registers n8n's webhook URL with Syndie.
3. When a lead event occurs, Syndie POSTs it to n8n and the workflow runs. The
   incoming JSON is emitted as the first item.

See [docs/n8n-trigger.md](./docs/n8n-trigger.md) for the lifecycle and payload
details.

### Syndie (Create Lead)

1. Add the **Syndie** node → Resource **Lead**, Operation **Create**.
2. Set **Campaign ID** (a campaign your Syndie account owns).
3. Add lead details under **Additional Fields** (name, job title, company,
   location, LinkedIn URL, …).
4. Execute — the node creates the lead and returns it.

See [docs/n8n-action.md](./docs/n8n-action.md) for the request/response contract.

---

## Testing

To run both nodes end-to-end against a Syndie backend from a publicly-reachable
n8n, follow [docs/testing-self-hosted.md](./docs/testing-self-hosted.md).

## Troubleshooting

- Ensure the **Syndie OAuth2 API** credential is connected.
- For the trigger, make sure `WEBHOOK_URL` points at your public host (not
  `localhost`) and the workflow is **Active**.
- Check the n8n **Executions** tab and logs for delivery/registration errors.

## License

[MIT](./LICENSE.md)

## Support

For help, contact [support@syndie.io](mailto:support@syndie.io).

## Links

- [Syndie.io](https://syndie.io)
- [n8n Documentation](https://docs.n8n.io)
