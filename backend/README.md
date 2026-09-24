# Shared room deployment

This backend makes recommendations and song feedback the same for everyone, with no visitor accounts. GitHub Pages continues to serve the dashboard. Cloudflare Workers runs AI and the API; D1 stores the shared state. A Cloudflare owner account is required once for deployment. Keep it on the Workers **Free** plan if you want hard free-tier limits rather than paid overages.

**Status:** the dashboard is configured for the deployed shared Worker. A successful live AI generation still needs verification. This repository does not contain Cloudflare credentials or the owner's playlist CSVs.

## Owner setup

Requires Node.js 22 or newer and a free Cloudflare account. From this repository:

```bash
cd backend
npm ci
npm run login
npm run db:create
npm run db:migrate
npm run deploy
```

`db:create` provisions the database and updates `wrangler.jsonc`. If it does not replace the placeholder database ID, copy the returned D1 UUID into `database_id` before migration/deployment. If the database already exists, use its existing ID instead of deleting or recreating it. Confirm `ALLOWED_ORIGIN` matches the website's origin (currently `https://navakanthboyina.github.io`, without a path).

Save the `https://munnas-grooves-shared.<your-subdomain>.workers.dev` URL printed by deploy. Visiting `/state` on that URL should return JSON with revision, batch and songRatings. No cloud AI call happens just by opening it.

Set an owner-only secret for playlist setup:

```bash
npx wrangler secret put ADMIN_TOKEN
```

Enter a long random secret when prompted. Keep it in a password manager. Never put it in frontend JavaScript, GitHub source, URLs, or chat. Visitors need no token.

## Starting playlist taste

Set `MUNNA_ADMIN_TOKEN` in your local environment to the same owner secret (prefer a hidden-input prompt or your password manager's environment integration; do not type a literal secret into shell history). Run:

```bash
node seed-playlists.mjs https://YOUR-WORKER.workers.dev /path/listen_with_me.csv /path/timeless_grooves.csv /path/my_shazam_tracks.csv
```

This replaces only the shared starting-song set. It preserves community feedback and the current batch. Artist credits supply rotating catalog search sources; playlist songs are excluded as already familiar. Raw playlist rows are not sent to AI or returned by the public state API. AI receives independently fetched catalog candidates and explicit community song feedback. This is metadata-based discovery, not audio analysis or Spotify synchronization.

## Activate the dashboard

After `/state` succeeds, set `apiBase` in `shared-config.js` to your Worker HTTPS URL. Commit that public URL to GitHub Pages. Never include `ADMIN_TOKEN` or a Cloudflare API token. Reload the dashboard and generate the first batch. Check it in a second browser. Changes propagate on page focus or within 60 seconds while the page is visible.

Old browser-only data is left on its original device and is not automatically published. Shared mode replaces its UI; uploads/restores cannot overwrite the room. Clear `apiBase` to return to the previous browser-local version if deployment needs troubleshooting.

## Behavior and limits

- Each song has one shared rating. The latest visitor choice replaces that song's previous choice; Clear removes it for everyone. This is intentionally **not** voting or one-person-one-vote.
- Everyone sees the same saved batch, without per-browser mood/language filters. The two-week plan splits that batch into two groups of up to six songs.
- Refresh runs server-side Llama 3.2 3B on Cloudflare. Up to 12 valid selections from 24 real catalog candidates are saved; fewer are possible. No non-AI fallback is labeled AI.
- No overlapping generations: a database lease serializes refresh. If feedback changes during generation, the stale result is discarded. The previous batch remains on failure, quota exhaustion, or conflict.
- Recent songs are excluded for 14 days globally. Rated and playlist-familiar songs remain excluded. A shared rating on a song does not apply to its whole artist.
- Refresh: 60-second room cooldown, maximum 30 attempts per UTC day (including failed attempts). Provider limits can be reached earlier. Workers AI currently includes 10,000 neurons/day on Free; usage across your account also counts.
- Feedback: 30 writes per minute per network address; short-lived minute-salted hashes, not raw IP addresses, are stored and removed by daily cleanup. Feedback and its timestamps are public. No visitor cookies or accounts are used.
- Origin checks reduce cross-site browser misuse; they are not authentication and cannot stop scripted clients. Anonymous shared ratings can be changed by any visitor. Use Cloudflare's owner controls to disable access if needed.
- Only the owner secret can change playlist starting data. Feedback is restricted to known shared/starter songs. No public API accepts arbitrary batches or full-profile replacements.
- Database exports are available through `npx wrangler d1 export DB --remote --output /private/path/room-backup.sql`. Keep exports private.

Catalog search tries Apple first and Deezer metadata if the Apple request fails. Up to 18 artist searches, with at most two provider requests each, are made per refresh. Each request has an 8-second timeout. Provider failures show only safe status summaries, never response bodies or secrets. Fallback behavior is tested with simulated responses; reachability from the deployed Worker must be checked live. Listening links remain on the dashboard’s supported platforms.

## Validation

```bash
# From repository root, Node 22+:
node --test tests/*.test.mjs
# With jsdom available:
node tests/shared-ui.cjs
# From backend:
npm run check
```

Backend tests execute real SQLite SQL behind a D1-shaped adapter, with stubbed catalog and AI calls. They test shared reads/writes, stale-write protection, concurrent generation, quota bounds, owner import protection, failure recovery and no-repeat history. Two independent DOM sessions exercise the shared frontend. A Wrangler dry-run validates the Worker bundle. These checks do not establish successful production AI inference; that requires the owner deployment and a live refresh.

References: [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [Llama 3.2 3B](https://developers.cloudflare.com/workers-ai/models/llama-3.2-3b-instruct/), [D1 CLI](https://developers.cloudflare.com/workers/wrangler/commands/d1/).
