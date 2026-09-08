# Changelog

## 0.4.0 — unreleased

Requires the Syndie backend release that delivers events (September 2026).

### Trigger
- **Events setting** with six events: Lead Replied, Connection Accepted, Status
  Changed, Lead Opted Out, Conversation Handed Off, Meeting Booked. All selected
  = one subscription for everything (what 0.3.x sent); a subset = one per event.
- **Signed deliveries.** Every delivery is checked against the secret the backend
  issued at subscribe time; anything else is answered 401 and starts no run.
  Workflows activated on 0.3.x are let through with a warning until re-activated.
- Activation is all-or-nothing; deactivation removes every subscription, treats
  404 as removed, and keeps failures on record for the next attempt.

### Action
- **Import** replaces Create: the person is matched by LinkedIn identifier or
  email inside the workspace and the existing contact is returned instead of a
  duplicate. LinkedIn URL and Email are now fields of their own.
- **Find** looks a lead up by LinkedIn URL or email; not found is a normal item.
- Saved 0.3.x workflows keep opening: the stored operation value is unchanged, a
  URL under Additional Fields is still read, Connection Status is ignored.

### Credential
- **API Base URL** field (default production) so the same package can be pointed
  at another backend; the token URL moved from `/oauth/callback` to `/oauth/token`.

### Package
- Build tool `@n8n/node-cli` 0.47; the tarball no longer ships the TypeScript
  build cache or a stray `dist/package.json`, and now ships `docs/`.
- `pnpm test`: a self-test that drives the built nodes with a stubbed n8n (56
  checks), run in CI.
- Category Sales (was Development); package description and keywords say what the
  nodes do; licence notice names Syndie.

## 0.3.2 — 2026

- Verified community node; published from GitHub Actions with provenance.
- OAuth2 (PKCE) credential fixed to the production API.
- Trigger subscribing to every event; action creating a lead.
