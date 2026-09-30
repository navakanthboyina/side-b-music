# Shared backend setup

The current architecture and operational limits are documented in the [project README](../README.md). This folder deploys `munnas-grooves-shared` on Cloudflare Workers with D1 and the Workers AI binding.

## Existing installation

```bash
git pull --ff-only origin main
npm run db:migrate
npm run deploy
npm run diagnose
```

The additive migration creates `song_resources`, `song_activity` and `activity_events`. Do not delete or recreate the existing database. No playlist re-import, new secret or paid plan is required for this upgrade. Existing D1 data and the public Worker URL are retained.

## New installation

Node 22 or newer, Git, and a Cloudflare Free account:

```bash
cd backend
npm ci
npm run login
npm run db:create
npm run db:migrate
npx wrangler secret put ADMIN_TOKEN
npm run deploy
```

`db:create` should set the database ID in `wrangler.jsonc`. For an existing database, use its current ID instead. Keep `ALLOWED_ORIGIN` equal to the GitHub Pages origin (no repository path). Set the public Worker URL in `../shared-config.js`.

For Last.fm discovery, enter your key using `npx wrangler secret put LASTFM_API_KEY`. Set `LASTFM_PUBLIC_APPROVED` to `true` only after satisfying Last.fm's requirements for this public application. These secrets already exist for the current room and do not need to be entered again. ListenBrainz is enabled by default and uses the official public similar-recordings dataset endpoint. No visitor account or token is required.

## Seed import (new installation only)

Set `MUNNA_ADMIN_TOKEN` locally to your owner secret without putting it in shell history or GitHub. Then:

```bash
node seed-playlists.mjs https://YOUR-WORKER.workers.dev "/path/listen.csv" "/path/timeless.csv" "/path/shazam.csv"
```

CSV columns: `Artist Name(s),Track Name` or `Artist,Title`; maximum 2 MB each. Import replaces seed songs while preserving feedback. Only the owner endpoint accepts imports. The existing 533-song room does not need re-importing.

## Diagnostics

`npm run diagnose` captures before/after state and Worker logs for three minutes, without triggering refresh. Once connected, refresh once in the dashboard and try a preview. Share the after snapshot and `munna-preview` events. Build: `candidate-ranking-1`.

`/admin/ai-check` is an owner-only, explicitly invoked model probe, not part of page loads. It can consume AI allowance. Normal loads, previews and ratings do not call AI. Actual preview activity is stored as small aggregates, separate from explicit ratings.

Keep the Worker on Free if you need hard free-tier limits. Provider coverage and free allowances can still cause incomplete drafts; deterministic ranking removes AI as a required dependency but cannot invent missing source or language evidence.
