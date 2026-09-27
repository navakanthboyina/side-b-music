# Shared room deployment

This backend makes recommendations and song feedback the same for everyone, with no visitor accounts. GitHub Pages continues to serve the dashboard. Cloudflare Workers runs AI and the API; D1 stores the shared state. A Cloudflare owner account is required once for deployment. Keep it on the Workers **Free** plan if you want hard free-tier limits rather than paid overages.

**Status:** the dashboard is configured for the deployed shared Worker. Live generation worked with the earlier ID-only model. The song-relevance revision requires deployment, a one-time playlist re-import, and live quality review. This repository does not contain Cloudflare credentials or the owner's playlist CSVs.

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

This stores the song titles and artist credits in the owner’s D1 database and replaces the starting-song set while preserving feedback. A rotating sample of up to 16 playlist/liked songs, up to 24 feedback entries, and real catalog candidates are sent to Cloudflare AI. Reference song names appear in public recommendation descriptions; the complete imported list is not returned by the public state API or committed to GitHub. Artist query terms go to catalog providers. This is metadata-based discovery, not audio analysis or Spotify synchronization.

Existing installations must run this import once after upgrading: older versions kept only normalized exclusion keys and artist names, which cannot reconstruct the original song titles. No new database migration or secret is needed. Batches without relevanceVersion 2 are hidden; feedback remains available.

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

Catalog search is restricted to artists credited on the selected reference songs, including collaborators. Generic credits such as Various Artists are not search sources. Apple results must match a credited artist after punctuation normalization. If they fail or yield no eligible tracks, Deezer is queried for an exact artist identity and that artist’s tracks by catalog ID. Up to 12 search sources and 36 provider calls are allowed, with 8-second per-request timeouts. This conservative pool does not promise discovery of entirely new artists; AI ranks individual songs within it.

Each candidate has one assigned reference song embedded directly in the AI input. The model returns only the candidate ID, a musical-fit estimate for that pair, and a song-specific reason. The backend resolves the description reference using the same assignment. An explicit conflicting reference ID is still rejected rather than silently relabeled. Only estimates at least 70/100 are accepted; this is a model self-assessment, not calibrated accuracy. At most two songs per credited artist and 12 per batch are kept. Returning fewer is allowed. The code verifies reference identity and candidate provenance; it cannot prove subjective musical similarity or every generated statement. Descriptions label those judgments as estimates and never claim audio analysis. Failure preserves the previous valid batch instead of filling slots with unrelated songs.

Owner diagnostics record only response shape, length, and validation errors, not generated replies or the taste prompt. This avoids logging reference-song details. Listening links remain on YouTube, SoundCloud, and Bandcamp.

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

Small batches receive one additional AI pass over the remaining candidates within the existing two-call budget. Accepted songs are retained if expansion fails. Relevance thresholds and per-artist limits apply across both passes. Saved selectionStats records candidate count and per-pass returned/accepted counts without the raw AI reply.
