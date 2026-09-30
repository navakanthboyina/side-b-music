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

`npm run diagnose` captures before/after state and Worker logs for three minutes, without triggering refresh. Once connected, refresh once in the dashboard and try a preview. Share the after snapshot and `munna-preview` events. Build: `preview-match-1`.

`/admin/ai-check` is an owner-only, explicitly invoked model probe, not part of page loads. It can consume AI allowance. Normal loads, previews and ratings do not call AI. Actual preview activity is stored as small aggregates, separate from explicit ratings.

Keep the Worker on Free if you need hard free-tier limits. Provider coverage and free allowances can still cause incomplete drafts; deterministic ranking removes AI as a required dependency but cannot invent missing source or language evidence.

## Optional AI fallback chain

The order is Workers AI Gemma → Groq `openai/gpt-oss-120b` → Gemini `gemini-3.1-flash-lite` → deterministic ranking. Unconfigured providers are skipped. The entire chain has a 30-second deadline, each provider is tried once, and every result must contain valid unique candidate IDs and satisfy the same diversity constraints. There are no tools, web searches, invented tracks or automatic paid upgrades. Failure still publishes a complete deterministic batch when discovery has supplied 12 eligible songs. AI cannot fill a missing-language or missing-discovery pool.

To enable optional providers, use **free-tier accounts with billing disabled**. The backend cannot inspect your account's billing plan. Gemini's free service may use submitted candidate/feedback text to improve Google products; review its terms before enabling it. Only the bounded shortlist and feedback sample are sent, never API secrets or your whole library. Skip either key to omit that provider.

From `backend`:

```bash
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put EXTERNAL_AI_FREE_TIER_CONFIRMED
```

Enter `true` for the last secret only after confirming those account settings and accepting the data use. Keys alone never enable external AI. Do not paste keys into chat, commit them, or put them in frontend files. Existing Cloudflare-only behavior works without any new secrets.

After deployment, `npm run diagnose` reports `ai.attempts` with provider, model, selected/failure outcome and HTTP status when available. `discovery.scheduling` shows backlog priority; `metadata_provider_cooldown` identifies MusicBrainz backoff. Apple preview attempts expose `limitSource` (`upstream`, `room_budget`, `provider_cooldown`) and retry delay. JSON tail mode has no Wrangler connection banner, so the diagnostic now uses read-only probes to confirm event delivery and preserves startup messages from stdout as well as stderr. Missing events are still reported honestly rather than interpreted as success.

References: [Groq models](https://console.groq.com/docs/models), [Groq free limits](https://console.groq.com/docs/rate-limits), [Gemini pricing and free-tier data use](https://ai.google.dev/gemini-api/docs/pricing).

## Familiar-song fallback

Fresh discoveries remain first. If discovery finishes with fewer than 12 songs, liked songs and then Already know songs may fill the remaining places, including recent recommendations. Disliked songs stay excluded, as do duplicate identities, wrong/unknown languages for language-filtered batches and songs exceeding the existing diversity caps. Mixed permits unknown language. The fallback uses saved verified language metadata, not language guesses from artist names or country. New feedback preserves available server-verified language labels for reuse. No extra AI or catalog request is needed to select familiar songs. AI may reorder the completed mix but cannot replace approved fresh songs with additional familiar ones.

Diagnostics expose `ratedFallback.added`, `eligible`, `blocked`, `language` and `remaining`. Remaining entries may be duplicates, hit a diversity cap or exceed available slots; they are not all failed songs. Existing compatible drafts survive this upgrade. The dashboard labels returning songs and distinguishes preview-provider failures from a confirmed missing preview. A provider HTTP 429 cannot be eliminated by changing recommendation rules.

For multi-performer preview searches, Deezer gets one shorter-credit retry after a successful response without a playable exact match. The title and credited-artist validation stays unchanged; provider errors are not retried. Diagnostics identify full_credits versus primary_credit without exposing the search query.

## Optional unverified-language familiar fill

Build `preview-match-1` adds `allowUnverifiedFamiliar` (boolean, default false) to POST /refresh. The checkbox is shown beside language selection. With explicit opt-in, liked and Already know songs whose language is unknown can fill an incomplete batch; their language stays Unknown and the card visibly labels the exception. Confirmed other-language tracks, dislikes, duplicate recordings and diversity caps remain enforced. Disabling the option filters unverified familiar songs out of resumed language-filtered drafts. New discoveries still require the selected language evidence. No schema change or new secret is needed.

The diagnostic no longer matches `cpuTime` followed by a preview `limitSource` as a CPU error. Only a specific exceeded-CPU outcome or explicit exception/error message triggers that finding.

## Preview match and playback diagnostics

Build `preview-match-1` compares titles after removing only a trailing quoted `(From "Soundtrack")` attribution. If both titles name a soundtrack, those names must agree. Live, remix, instrumental and language-version labels are retained. A matching credited artist is still required; contributors supplied by the catalog can establish that credit. Preview attempt diagnostics include rejected title, artist and invalid-ID counts, without search terms or media URLs.

A catalog `found:true` means a preview URL was returned, not that the browser played it. The player now distinguishes autoplay permission from network, decoding and unsupported-source failures. Those browser playback errors appear in the player; Wrangler only sees backend lookups. Apple 429 and absent Deezer coverage remain external limitations, and the existing cooldown and YouTube fallback are retained.
