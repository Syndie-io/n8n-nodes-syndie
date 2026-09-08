# Contributing

This covers the local loop, the conventions, and how a release reaches npm and
n8n's verified registry. For how the code is structured read
[ARCHITECTURE.md](./ARCHITECTURE.md) first.

## Prerequisites

- **Node.js ≥ 20.15** and **pnpm 11** (`corepack enable` picks the pinned version).
- For a real round trip, a publicly reachable n8n and a Syndie backend you may
  point the credential at ([docs/testing-self-hosted.md](./docs/testing-self-hosted.md)).

## Local loop

```bash
pnpm install        # pnpm-workspace.yaml already declines the native optional builds
pnpm lint           # n8n's community-node rules; a lint error blocks verification
pnpm build          # dist/
pnpm test           # scripts/self-test.mjs against dist/ — 56 checks, ~1 s
npm pack --dry-run --ignore-scripts   # what would ship: dist, docs, README, LICENSE
pnpm dev            # build + watch, linked into a local n8n
```

## Conventions

- **TypeScript, Prettier** (tabs, single quotes, 100 columns). `pnpm format`.
- **`pnpm lint` and `pnpm test` must be green.** The self-test is the only
  automated proof the nodes behave; extend it when you change behaviour.
- **The API address comes from the credential.** Read it with
  `getSyndieBaseUrl()` and build URLs with `syndieApiUrl()`; never hard-code a
  host or add a second URL field.
- **Shared logic goes in `GenericFunctions.ts`**, pure and importable by the
  self-test, not inside a node class.
- **No runtime dependencies** (verified nodes may not have any); Node's `crypto`
  is the only built-in used.
- **Keep saved workflows opening.** Stored parameter values (`create`, `find`,
  `events`) and the static-data shape are contracts; change labels, not values,
  and read old shapes when you add new ones.
- **English-only** UI strings and docs.
- When a node's parameters or the backend contract change, update `docs/` in the
  same commit.

## Commits

One idea per commit. The subject says what changed in plain words; the body says
what was wrong, what changes, what was deliberately not done, and what was run to
prove it. No AI attribution.

## Releasing

Publishing happens **only on a version tag**; merging never publishes.

1. On the default branch, with CI green: bump `version` in `package.json`, add the
   entry to `CHANGELOG.md`, commit as `chore(release): x.y.z`.
2. Tag and push the tag:
   ```bash
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```
   `publish.yml` matches `*.*.*` tags, builds, and publishes to npm with a
   provenance attestation through GitHub OIDC Trusted Publishing (no token).
   (`n8n-node release` exists but insists on a branch named `main`; the manual
   path above does the same thing.)
3. Verify: `npm view @syndie/n8n-nodes-syndie@X.Y.Z dist.attestations` and
   `npx @n8n/scan-community-package @syndie/n8n-nodes-syndie@X.Y.Z`.
4. Check the listing on the n8n Creator Portal (<https://creators.n8n.io>) shows
   the new version as verified; resubmit there if it does not pick it up.

The package publishes publicly because `publishConfig.access` is `public`.

## Questions

[support@syndie.io](mailto:support@syndie.io)
