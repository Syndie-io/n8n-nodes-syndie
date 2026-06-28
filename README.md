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
- **Action** to create leads in your Syndie account
- Provider-agnostic backend (the same API powers Zapier / n8n / Make)
- Usable as AI agent tools (`usableAsTool`)

All nodes connect to the Syndie **production** API (`https://api.syndie.io`).

---

## Installation

In n8n: **Settings → Community Nodes → Install** and enter:

```
@syndie/n8n-nodes-syndie
```

Requires `N8N_COMMUNITY_PACKAGES_ENABLED=true` on self-hosted instances. Once the
package is accepted into n8n's **Verified Community Nodes** program it installs
directly from the in-app nodes panel (including on n8n Cloud) without that flag.

> **Contributing / building from source?** See
> [CONTRIBUTING.md](./CONTRIBUTING.md) for the local dev loop and release process,
> and [ARCHITECTURE.md](./ARCHITECTURE.md) for how the nodes, credential, and
> Syndie backend fit together.

---

## Credentials

Both nodes use the single **Syndie OAuth2 API** credential.

1. Enter the **Client ID** provided by Syndie.
2. Client ID: Syndie, Client Secret: Syndie
3. Click **Connect** and complete the OAuth2 (PKCE) flow.

The Authorization and Token URLs are fixed to the Syndie production API, so there
is nothing else to configure.

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
2. Add lead details under **Additional Fields** (name, job title, company,
   location, LinkedIn URL, …). All fields are optional; empty ones are omitted.
3. Execute — the node creates the lead in your connected account and returns it.

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
