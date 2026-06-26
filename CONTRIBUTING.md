# Contributing

Thanks for working on `@syndie/n8n-nodes-syndie`. This guide covers the local
dev loop, the conventions to follow, and how a release reaches npm and n8n's
verified registry. For *how the code is structured*, read
[ARCHITECTURE.md](./ARCHITECTURE.md) first.

## Prerequisites

- **Node.js ≥ 20.15** and **pnpm** (the repo pins `pnpm@11`; `corepack enable`
  picks it up automatically).
- A local n8n instance for manual testing (see
  [docs/testing-self-hosted.md](./docs/testing-self-hosted.md)).

## Local development loop

```bash
pnpm install        # respects pnpm-workspace.yaml build approvals
pnpm dev            # build + watch, links the package into a local n8n
pnpm build          # one-off production build into dist/
pnpm lint           # n8n community-node lint (ESLint 9, must pass for verification)
pnpm lint:fix       # auto-fix what it can
pnpm format         # prettier over nodes/ and credentials/
```

To load an unpublished build into n8n, point it at the build output:

```bash
N8N_CUSTOM_EXTENSIONS=/path/to/n8n-nodes-syndie/dist
```

or `npm link` the package into your n8n custom directory (`~/.n8n/custom`).

## Project conventions

- **TypeScript only**, formatted by Prettier (tabs, single quotes, 100 cols —
  see `.prettierrc.js`). Run `pnpm format` before committing.
- **`pnpm lint` must be clean.** The n8n lint rules are the same ones the
  verification scanner enforces; a lint error is a verification blocker.
- **One production base URL.** All Syndie URLs derive from `SYNDIE_API_BASE_URL`
  in `credentials/SyndieOAuth2Api.credentials.ts`. Don't hardcode URLs elsewhere
  or reintroduce free-text URL inputs — they break n8n verification.
- **No runtime dependencies.** Verified nodes may not have `dependencies`; only
  `devDependencies` and the `n8n-workflow` peer. Keep it that way.
- **English-only** UI strings and docs (a verification requirement).
- If you change a node's parameters or the backend contract, update the matching
  file under `docs/` in the same PR.

## Making a change — checklist

1. Branch off the default branch.
2. Make the change; keep nodes, credential, and `docs/` in sync.
3. `pnpm lint && pnpm build` — both green.
4. Manually test against a real n8n + the Syndie production API
   ([docs/testing-self-hosted.md](./docs/testing-self-hosted.md)). The OAuth flow
   and webhook round-trip can't be unit-tested — verify them by hand.
5. Open a PR. CI (`.github/workflows/ci.yml`) re-runs lint + build on every push.

## Releasing to npm

Publishing is automated and **only happens on a version tag** — committing or
merging never publishes.

1. Make sure `main` is green (lint + build) and `docs/` are up to date.
2. Run the release helper, which bumps the version, updates the changelog,
   commits, tags, and pushes:
   ```bash
   pnpm release
   ```
   (Or bump `package.json` and push a `*.*.*` tag manually.)
3. The tag triggers `.github/workflows/publish.yml`, which publishes to npm
   **with an npm provenance attestation** via GitHub Actions OIDC Trusted
   Publishing — no long-lived token. This is mandatory for verified nodes as of
   1 May 2026.

The scoped package publishes publicly because `package.json` sets
`publishConfig.access: "public"`.

## Getting the node verified by n8n

The package already meets the hard technical gates (scoped `@…/n8n-nodes-*` name,
`n8n-community-node-package` keyword, MIT license, zero runtime deps, lint clean,
provenance publishing). To get it into n8n's **Verified Community Nodes** registry
(installable in-app, including on n8n Cloud, without the community-packages flag):

1. Publish a release via GitHub Actions with provenance (above).
2. Confirm `npx @n8n/scan-community-package @syndie/n8n-nodes-syndie` passes.
3. Submit the node at the **n8n Creator Portal** (<https://creators.n8n.io>).
   An automated review runs first, then n8n's team manually vets it.

See n8n's
[verification guidelines](https://docs.n8n.io/integrations/creating-nodes/build/reference/verification-guidelines/)
for the authoritative, current rules.

## Questions

Reach the maintainers at [support@syndie.io](mailto:support@syndie.io).
