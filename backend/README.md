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
- Refresh runs server-side Llama 3.1 8B on Cloudflare. Exactly 12 valid selections are required before saving a new batch; incomplete attempts leave the previous batch unchanged. No non-AI fallback is labeled AI.
- No overlapping generations: a database lease serializes refresh. If feedback changes during generation, the stale result is discarded. The previous batch remains on failure, quota exhaustion, or conflict.
- Recent songs are excluded for 14 days globally. Rated and playlist-familiar songs remain excluded. A shared rating on a song does not apply to its whole artist.
- Refresh: 60-second room cooldown, maximum 30 attempts per UTC day (including failed attempts). Provider limits can be reached earlier. Workers AI currently includes 10,000 neurons/day on Free; usage across your account also counts.
- Feedback: 30 writes per minute per network address; short-lived minute-salted hashes, not raw IP addresses, are stored and removed by daily cleanup. Feedback and its timestamps are public. No visitor cookies or accounts are used.
- Origin checks reduce cross-site browser misuse; they are not authentication and cannot stop scripted clients. Anonymous shared ratings can be changed by any visitor. Use Cloudflare's owner controls to disable access if needed.
- Only the owner secret can change playlist starting data. Feedback is restricted to known shared/starter songs. No public API accepts arbitrary batches or full-profile replacements.
- Database exports are available through `npx wrangler d1 export DB --remote --output /private/path/room-backup.sql`. Keep exports private.

Catalog search is restricted to artists credited on the selected reference songs, including collaborators. Generic credits such as Various Artists are not search sources. Apple results must match a credited artist after punctuation normalization. If they fail or yield no eligible tracks, Deezer is queried for an exact artist identity and that artist’s tracks by catalog ID. Each pool uses up to six previously unqueried search sources. A refresh can fetch three pools, up to 24 new candidates each, within a shared 30-request catalog budget and 155-second generation deadline. Requests time out after at most 8 seconds; each AI call after at most 35 seconds. This conservative pool does not promise discovery of entirely new artists; AI ranks individual songs within it.

Each candidate has one assigned reference song embedded directly in the AI input. The model returns only a candidate ID and musical-fit score for the supplied pair. Extra model fields, including reference IDs and explanations, are ignored. The backend builds a factual description from the same assigned reference, identifies playlist/liked provenance, and labels musical fit as estimated. It does not reuse model-written musical claims, even when the model adds them. Only estimates at least 70/100 are accepted; this is a model self-assessment, not calibrated accuracy. At most two songs per credited artist are kept, including across pools. The model may return fewer, but the backend must accumulate 12 across pools before committing. The code verifies reference identity and candidate provenance; it cannot prove subjective musical similarity. Displayed descriptions use verified reference data and do not claim particular tempo, instruments, or mood. Descriptions label those judgments as estimates and never claim audio analysis. Failure to reach 12 preserves the previous valid batch instead of saving a small batch or filling slots with unrelated songs.

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

References: [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [Llama 3.1 8B](https://developers.cloudflare.com/workers-ai/models/llama-3.1-8b-instruct/), [D1 CLI](https://developers.cloudflare.com/workers/wrangler/commands/d1/).

Small selections receive one additional AI pass over the current pool. If still below 12, the backend fetches a new pool from different taste sources, excludes all candidates already examined during this refresh, and retains accepted picks in memory. All later passes preserve the global duplicate, relevance, and artist limits. At most three pools and six AI calls are attempted. Pool counts, total distinct candidates, per-pass rejection counts and actual catalog HTTP request counts are recorded in selectionStats. Zero-pick failures return counts with their error. Nonempty incomplete attempts save a draft and return pending progress; neither replaces the visible batch. The D1 lease remains three minutes, longer than the generation deadline. This bounding prevents indefinite retries; it cannot guarantee 12 qualifying tracks during an outage or depleted catalog.

Run `npm run test:runtime` from this directory to exercise the catalog request wrapper in the actual local Cloudflare runtime. This uses synthetic responses and no external network traffic. Catalog redirects use manual mode, follow at most two redirects within the allowed provider hosts, and count every hop toward the same request budget. Workers does not support `redirect: "error"`; Node-only tests are not sufficient for that option.

Incomplete nonempty selections are stored in D1 as a private draft, with approved songs and search progress. The next refresh resumes that draft; the public state exposes its count, not its songs. Once 12 qualify, the batch is committed atomically and the draft cleared. Drafts expire after 24 hours without progress. Any song-feedback write or playlist re-import clears a draft, so scores from an old taste profile cannot carry forward. Optimistic concurrency also prevents feedback arriving during generation from being overwritten. Incomplete drafts are not marked as shown. Each continuation still counts as one refresh attempt and obeys the same request/time limits. A previous short batch is split across both weeks rather than leaving Week 2 blank.

### Song search and the two-week plan

A complete shared batch contains 12 songs, split into 6 per week. Older batches stay visible until a full replacement is ready; drafts carry progress across refreshes. This does not guarantee completion during catalog or AI outages.

In **Shared taste**, search by song title and artist and click **Add to taste**. Apple catalog search falls back to Deezer. The server looks up the selected catalog ID before recording an individual shared like; browser-supplied titles are not trusted. The added song guides future picks and is excluded from recommendations. Clear its like in Shared feedback to remove that influence. Search queries go to the catalog; added songs and ratings are public. Adding a new like resets an unfinished draft. No account, import, schema migration or new secret is required.

The public API exposes `batchTarget`, `pendingSongCount` and `pendingSelectionStats` for diagnosing unfinished generation. Search and add use the existing network rate limit. POST `/search` accepts `{ "query": "song and artist" }`; POST `/taste/add` accepts a returned `{ "provider": "apple", "id": 123 }`. Both require the dashboard Origin.

### Bounded AI selection (bounded-selection-12-1)

The target is 12 accepted songs: six per week. Workers AI now uses `@cf/meta/llama-3.1-8b-instruct`, a model listed as supporting JSON mode, with a `json_schema` response format. Each pool has its own ID enum and maximum array length. Prompts cap the requested selection count at the smaller of pool size and remaining slots; they never ask a four-song pool to fill a full batch. Runtime validation still rejects invented IDs, weak scores and repeats. Invalid JSON or inference failure gets one bounded retry; complete JSON surrounded by prose can be parsed, but incomplete JSON is never guessed or repaired into selections. No catalog-only filler is labeled AI. Searches omit artists already at the two-song cap. Existing approved drafts continue toward the smaller target, capped at 12 when published. Free AI allowance and catalog availability still apply; the larger model may consume allowance faster.

Schema documentation: https://developers.cloudflare.com/workers-ai/features/json-mode/ . Tests use synthetic provider/AI fixtures and the local Cloudflare runtime; live AI quality and completion still need verification after deployment. No migration or playlist re-import is required.

### Inference failure reporting (inference-errors-12-1)

AI exceptions are classified as quota, rate limit, access, unavailable model, timeout, response format or unknown provider error. Public diagnostics contain only this category, a fixed description and an optional numeric code; raw exception text is never published because providers can echo input. All failed inference attempts produce a service error, not a claim that taste matches were absent. Quota/access failures stop further work immediately. If the provider explicitly rejects JSON mode or its grammar, the second attempt omits response_format; the same candidate ID, score, reference, duplicate and artist validators still run. There is no fallback to unvalidated or non-AI songs. The target remains 12 songs, six per week.

### Isolating live inference errors (active-model-12-1)

Leading numeric Workers AI error codes and string exceptions are recognized. Unclassified provider failures receive one retry without response_format, with all application validators retained. This does not assert the schema is the cause. To identify the actual upstream failure, owner-authenticated POST `/admin/ai-check` runs at most two fixed synthetic requests (plain then structured), returning their original errors to the owner only. It does not read playlist data, search the catalog, or change the room. It uses AI allowance and is limited to once per minute. Stop-class errors end the check immediately. Run `node check-ai.mjs <worker-url>` with MUNNA_ADMIN_TOKEN set to the saved owner password. Never commit that token.

### Retired model replacement (active-model-12-1)

The deployed service returned 5028 for the old `@cf/meta/llama-3.1-8b-instruct` alias, reporting retirement on 2026-05-30. The active selection and owner probe now use `@cf/meta/llama-3.1-8b-instruct-fp8`, listed in the current catalog: https://developers.cloudflare.com/workers-ai/models/llama-3.1-8b-instruct-fp8/ . Code 5028 stops immediately and tells the owner the model was retired. This corrects the model choice in earlier notes. Local tests do not establish account-specific live availability; use the owner probe after deploying to check it.

### Score the full pool (full-pool-scores-12-1)

Live diagnostics showed FP8 structured mode failing with 5025 while its plain response succeeded. Generation now starts without response_format; the owner probe can still compare both modes. The prompt requests one score for every supplied candidate, including scores below threshold, rather than asking the model to fill a batch or stop at its favorite. Application validators retain the same 70 threshold, valid-ID checks, reference pairing, duplicates and artist limits. A short first reply gets a second pass asking for remaining IDs. The target remains 12 accepted songs, six per week. Catalog HTTP/network failures accumulate per host within a refresh; after three failures future requests to that host are skipped while the other provider remains available. Already in-flight requests can still finish. The overall 30-request limit remains unchanged. Provider failure counters are included in diagnostics. This reduces wasted calls; it cannot guarantee catalog availability or AI relevance.

### Score coverage diagnostics (score-coverage-12-1)

When every candidate has a valid score, generation advances to a fresh pool instead of asking the model to rescore rejected songs. Retry instructions list only IDs not yet scored. Each attempt reports scoredIds and scoreDistribution (numeric score → count); this reveals scale mismatches and actual scores without exposing song names or raw model output. The 70/100 cutoff is unchanged. These are model estimates, not calibrated probabilities or verified audio similarity. This change saves redundant calls and improves diagnosis; it does not establish that the available catalog candidates are relevant enough to complete a batch.
