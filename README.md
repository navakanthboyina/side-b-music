# Munna’s Grooves

[Open the dashboard](https://navakanthboyina.github.io/side-b-music/)

One shared listening room, with no visitor sign-in. Everyone sees the same saved recommendations and can rate individual songs. GitHub Pages serves the frontend; Cloudflare Workers, D1 and Workers AI handle shared taste, recommendations and feedback.

## How recommendations work

- The owner imports playlist CSVs with `Artist Name(s),Track Name` or `Artist,Title` headers, maximum 2 MB each.
- Up to 16 representative playlist songs and explicit liked songs provide song-level taste references. Likes take priority. Rated songs are excluded from new discoveries; skips are negative evidence, and Already know is exclusion only.
- Discovery resolves a specific reference song in Deezer, with Apple as fallback, by title and credited artist. It verifies that the reference and candidates belong to the same catalog release. Same-artist search results alone are not eligible. Other performers on that release can be discovered.
- Llama 3.1 8B FP8 ranks these verified connections using reference-song feedback and available release metadata. Its numeric priority is not a calibrated probability or a musical-similarity gate. Unknown song titles no longer fail just because the model cannot recall their sound.
- Each description identifies the reference song, its liked/playlist origin, the shared release and catalog provider. Available genre is described as a release-level tag. No tempo, instrumentation or mood claims are generated. Sharing a release does not guarantee similar sound.
- Complete batches contain 12 AI-ranked songs, at most two per credited artist, release and reference song. Incomplete new drafts persist across refreshes. Drafts from the old scoring algorithm are rebuilt; playlists, feedback and the visible batch remain saved. Discovery is currently within verified releases, not a general song-similarity service or an audio-analysis system.
- Songs shown within 14 days, playlist-familiar songs and rated songs are excluded. The saved batch is split across two weeks, with all languages mixed. Older short batches are divided between both weeks; completed batches contain six songs per week.

Playback stays on YouTube, SoundCloud or Bandcamp through search links. The comfort mixes are fixed curated lists, not live AI recommendations.

## Shared feedback and refresh

Like, Not for us, Already know and Clear apply to individual songs. The latest visitor rating replaces the previous shared rating for that song; this is not voting. Feedback affects the next generation, not the currently saved batch. Browsers sync on focus or within 60 seconds while visible.

Refresh is manual, with a 60-second cooldown and a room-wide limit of 30 attempts per UTC day. Provider allowances may limit usage earlier. Existing valid picks remain if generation fails. No invented songs or unrelated fallback tracks fill empty slots. Small selections trigger additional catalog searches using different taste sources, not just another AI call over the same songs. A refresh tries up to three pools (24 new candidates each), two AI calls per pool, 30 catalog HTTP requests total, and a 155-second generation budget. Provider failures or too few qualifying matches can still prevent completion.

## Setup and upgrading

See [backend setup](backend/README.md) for deployment and owner-only import commands. Existing installations upgrading to relevance version 2 must **re-import their playlists once**: the earlier backend did not retain original song titles. No new D1 migration or admin password is required. Older recommendation batches are hidden; existing feedback is retained.

The public Worker URL is in `shared-config.js`. Never put an admin token or Cloudflare credential in frontend code or GitHub. The owner deploys backend updates from their authenticated computer:

```bash
cd backend
git pull --ff-only origin main
npm run deploy
```

## Data and limitations

The complete imported song list is stored in D1. A bounded sample of playlist/liked songs, recent feedback and candidates is sent to Cloudflare AI. Search artist names go to Apple or Deezer. Reference-song names appear publicly in recommendation descriptions. Shared feedback is public. The original CSV files and credentials are not committed here. There is no automatic Spotify connection or listening-history import.

No audio is analyzed. The model may misunderstand a song; its similarity descriptions are explicitly estimates. Tests verify data flow, identity checks, filtering, feedback behavior and safe failure handling. They do not prove that live recommendations will suit every listener.

## Validation

```bash
node --test tests/*.test.mjs
# With jsdom available:
node tests/shared-ui.cjs
cd backend
npm run check
```

The backend suite uses real SQLite with simulated catalog/AI services. The browser test checks two independent shared sessions. `npm run check` validates the Worker bundle without deploying. Live provider access and musical quality must also be reviewed after deployment.

The earlier browser-local implementation remains available only if `apiBase` is cleared. Its local feedback is not automatically uploaded into the shared room.

### Song search and the two-week plan

A complete shared batch contains 12 songs, split into 6 per week. Older batches stay visible until a full replacement is ready; drafts carry progress across refreshes. This does not guarantee completion during catalog or AI outages.

In **Shared taste**, search by song title and artist and click **Add to taste**. Apple catalog search falls back to Deezer. The server looks up the selected catalog ID before recording an individual shared like; browser-supplied titles are not trusted. The added song guides future picks and is excluded from recommendations. Clear its like in Shared feedback to remove that influence. Search queries go to the catalog; added songs and ratings are public. Adding a new like resets an unfinished draft. No account, import, schema migration or new secret is required.

The public API exposes `batchTarget`, `pendingSongCount` and `pendingSelectionStats` for diagnosing unfinished generation. Search and add use the existing network rate limit. POST `/search` accepts `{ "query": "song and artist" }`; POST `/taste/add` accepts a returned `{ "provider": "apple", "id": 123 }`. Both require the dashboard Origin.

### Bounded AI selection (bounded-selection-12-1)

The target is 12 accepted songs: six per week. Workers AI now uses `@cf/meta/llama-3.1-8b-instruct`, a model listed as supporting JSON mode, with a `json_schema` response format. Each pool has its own ID enum and maximum array length. Prompts cap the requested selection count at the smaller of pool size and remaining slots; they never ask a four-song pool to fill a full batch. Runtime validation still rejects invented IDs, weak scores and repeats. Invalid JSON or inference failure gets one bounded retry; complete JSON surrounded by prose can be parsed, but incomplete JSON is never guessed or repaired into selections. No catalog-only filler is labeled AI. Searches omit artists already at the two-song cap. Existing approved drafts continue toward the smaller target, capped at 12 when published. Free AI allowance and catalog availability still apply; the larger model may consume allowance faster.

Schema documentation: https://developers.cloudflare.com/workers-ai/features/json-mode/ . Tests use synthetic provider/AI fixtures and the local Cloudflare runtime; live AI quality and completion still need verification after deployment. No migration or playlist re-import is required.

### Diversity limits (diverse-releases-1)

A complete 12-song batch has at most two picks per artist, per release and per reference song. Limits apply across AI passes, pools and resumed drafts. Release identity checks both provider-specific IDs and normalized release titles so switching catalog providers cannot admit the same collection again; this conservatively also caps unrelated releases sharing a title. Diagnostics report `releaseLimit` and `referenceLimit` rejections. Previously saved batches remain visible; unfinished drafts from earlier builds are rebuilt under the new rules. Filling the batch requires at least six distinct reference songs and releases, so additional refreshes may be needed.


### Listening room and language preferences (listening-room-2)

The dashboard has a record-inspired visual design, collapsible song explanations, draft progress, and a language choice beside Refresh. Choose Mixed, Telugu, Hindi, English, Tamil, Kannada, Malayalam, Punjabi or Bengali. The choice applies to the next shared batch, not just the current browser's display. POST `/refresh` accepts `{ "language": "Telugu" }`; omitting it means Mixed. Unsupported values return 400.

Sung language is estimated by AI from metadata, not verified by listening. Specific-language batches reject unknown or other-language labels. Mixed permits unknown labels. This can reduce available candidates; 12 picks are still required before replacing the visible batch. A new language starts a separate draft; the existing incomplete draft is replaced, not combined. The current batch keeps its original language label until a replacement is ready. Feedback, repeat exclusions and all diversity limits still apply.

Deploy the backend after pulling this update. Non-Mixed controls stay disabled until the server advertises language support. No database migration, new secret or playlist import is needed. The active model is `@cf/meta/llama-3.1-8b-instruct-fp8`, using plain JSON replies; older model/structured-output notes above describe historical builds.


### Deezer previews and multiple languages (vinyl-multilang-1)

Song cards offer **Preview · 30 sec**. Clicking looks up an exact normalized title and matching artist in Deezer, then plays the catalog's preview URL directly in one persistent browser player. The vinyl spins only on the audio `playing` event; pause, buffering, errors and completion stop it. Reduced-motion preferences disable rotation. Closing or selecting another song cancels stale lookups; playback is local to each browser and does not change shared feedback. A Deezer link provides attribution and full-listening navigation. Missing previews and provider failures leave the normal listening links available. Some browsers require pressing the audio control again after loading. Availability and regional playback are provider-dependent.

POST `/preview` accepts an existing dashboard song's `{ "artist": "…", "title": "…" }`. It is Origin checked, rate limited, read-only, and does not expose arbitrary URLs. Only HTTPS Deezer/dzcdn preview hosts are allowed. Audio is neither proxied nor saved by the Worker. No key, database migration or model call is required for previews.

Language chips now toggle multiple preferences, for example Telugu + Hindi + English. All languages clears specific selections; deselecting the final language returns to All languages. POST `/refresh` accepts `{ "languages": ["Telugu", "Hindi"] }`, with legacy single `language` still supported. Selection is canonicalized so order does not reset drafts. Picks may match any selected language; equal numbers for each language are not guaranteed. Language remains AI-estimated. Mixed cannot be combined with specific languages. Changed preferences start a new draft while preserving the visible batch.

Validation: 62 automated tests plus shared-session DOM and preview-event tests; Worker dry-run build passes. Media behavior uses simulated browser events in tests; real Deezer audio availability needs checking after backend deployment. Pull main and run `npm run deploy` from backend, then reload the dashboard. No playlist re-import is needed.

### Language retry correction (language-retry-1)

Specific-language refreshes now retry missing or invalid language fields instead of counting those rows as fully evaluated. Every retry explicitly requires language along with ID and score. Valid Unknown or other-language classifications stay excluded; the requested preference is never used to fill missing labels. Complete JSON arrays of scored objects are accepted as well as the documented picks object. Malformed/incomplete JSON remains rejected. Candidate examination is recorded only after a valid score and required label, and the reply budget is 2,000 tokens. Validation logs include rejection counts, format errors and aggregate language distributions without song text. These changes fix format/retry failures but cannot guarantee sufficient eligible songs in a specific language. 64 regression tests pass, including missing-label retry and Unknown exclusion.


### Language-aware discovery (language-discovery-1)

A specific-language refresh first classifies up to 64 existing taste references in one bounded, plain-JSON AI call (20-second timeout). Matching references are searched first; these estimates only order retrieval and are never copied onto recommended tracks. If classification fails, normal playlist order is retained. Mixed skips this call. Diagnostics expose aggregate `referenceLanguages` coverage. This adds an AI call for language-specific refreshes and still uses the existing overall deadline and catalog request cap.

Specific-language retrieval tries Apple metadata before Deezer. Explicit single-language catalog genre tags such as Telugu can establish a metadata language estimate even when the ranker returns Unknown. Broad tags such as Bollywood or Indian do not map to a language; conflicting tags and explicitly instrumental titles do not supply a label. Tracks with explicit other-language tags are omitted. Both catalog-tag and AI estimates remain metadata-based, not audio verification; saved picks include `languageBasis`. Artist, release, reference, song-feedback and repeat exclusions still apply. Tests reproduce an all-Unknown ranker with tagged catalog data and verify 12 eligible picks; this is a synthetic regression, not a live provider guarantee. No migration or re-import is required.


### Compact ranking prompt (compact-selection-1)

AI now sees only sequential candidate IDs. Provider track IDs, album IDs and reference IDs remain server-side for validation, removing an avoidable source of ID confusion. The prompt retains song, artist, release, reference and explicit language tag, with shorter instructions and no generated reasons. Retry context excludes cumulative score distributions. Drafts from `language-discovery-1` remain compatible because eligibility rules are unchanged. Timeout limits remain bounded; this reduces input size but cannot prevent provider outages or guarantee completion. Regression tests verify hidden provider IDs and resuming the previous build's draft.


### Unrated repeats, comfort rotation, and search previews (comfort-replay-1)

Unrated recommendations may now appear again even within 14 days. Shared likes, skips and Already know ratings still exclude a song from discovery; duplicate songs within a batch remain blocked. Playlist starting songs remain familiar and excluded from discovery. Compatible existing drafts are retained.

Comfort mixes now show up to 12 songs from playlist seeds and shared likes, excluding skipped songs, split into two sets. Order rotates daily (UTC) and the shared Shuffle button advances the selection for everyone. It does not alter ratings or discard a pending recommendation draft. The selected comfort titles are publicly visible; the full seed list is not returned. Comfort mixes are familiar selections, not AI-generated discovery. POST `/comfort/shuffle` uses existing Origin and rate limits.

Comfort rows and search results have Deezer preview controls. Search previews send the provider and ID for a server-side lookup and never add feedback. Deezer search IDs play that exact catalog preview. Apple results are verified by ID, then searched for a matching Deezer title/artist; a Deezer counterpart may not exist. Playback remains one browser-local player with vinyl animation. Add to taste remains a separate action. No migration or playlist re-import is needed.


### Two-day plan and section navigation

The shared plan now divides the saved 12-song batch into Day 1 and Day 2, six songs per day. This changes the listening plan labels, not the refresh schedule or saved batch. Section links, repeated clicks on the active section, and browser back/forward open the selected section at the top and move keyboard focus to its heading. Removed the requested long setup/privacy notice from Shared taste. This is a frontend-only update; no Worker deployment is needed.


### Small reference batches and cache (reference-cache-1)

Language-specific discovery classifies at most 16 uncached references in two concurrent groups of eight, with a 20-second timeout per group and 500 output tokens. Successful individual labels are retained independently of other group failures. Cached labels are used only to prioritize reference searches, not to label recommended songs. Unknown and malformed labels are not cached. Cache lifetime is 30 days, capped at 512 entries, stored privately in existing D1 JSON without migration. Successful labels survive refreshes that fail to produce picks; this metadata-only write preserves concurrent song feedback.

`referenceLanguages` diagnostics include cached coverage, matches, per-group accepted/unknown/invalid counts, and sanitized failure categories (`timeout`, `invalid_json`, `missing_picks_array`, `provider_error`) with numeric provider codes when available. No generated song text is logged. Existing comfort-replay, compact-selection and language-discovery drafts remain compatible. The existing request deadline and selection limits remain; live AI or catalog availability can still prevent a full batch.


### Language-first catalog searches (language-search-1)

Specific-language refreshes now search language + taste artist before the existing reference-release fallback. Multi-language queries alternate across selected preferences; Mixed retains broad reference discovery. New search candidates must match an artist credit from a specific taste song and have explicit catalog language metadata (a narrow genre tag or explicit track “(Telugu Version)” style label). Query words alone never establish language. Unknown, unrelated, familiar and rated songs are excluded from this new search path. AI then ranks the remaining candidates against individual feedback; artist-linked discoveries require a score of at least 70. Descriptions distinguish an artist connection from a shared release.

Diagnostics include `discoveryMode` and `languageSearch` query, metadata rejection and failure counts. The existing request budget and draft compatibility remain. Catalog coverage can be incomplete, particularly where genre tags omit language, so no full-batch guarantee is implied. Fallback release discoveries retain their prior language validation. Tests cover a full 12-song language-search batch, mixed preferences and false search hits using synthetic catalogs. Deploy the Worker after pulling; no migration or re-import.


### Catalog recovery (catalog-recovery-1)

Refresh catalog responses are cached privately in existing D1 JSON (no migration): successful JSON only, up to 100 KB per entry and 700 KB total. Fresh entries are reused for 24 hours; entries up to seven days old can cover a failed request. All eligibility checks still run on cached tracks. Cache results survive refresh failures, preserving concurrent feedback. A newly deployed cache starts empty; it cannot recover data that has never been fetched successfully. Cached catalog availability is not a guarantee of current audio availability.

Network timeouts and network exceptions now count toward the same circuit as HTTP failures. `catalogErrors` reports host, category and HTTP status without query text or response bodies. Once both provider circuits are paused, remaining pools stop immediately. Drafts remain saved and refresh messages identify the outage. Diagnostics distinguish `catalogCacheHits`, `catalogStaleHits`, actual network requests and stop reason. All prior draft builds stay compatible. Live third-party blocking/outages remain external; tests simulate outages and cache recovery, not live Worker egress.
