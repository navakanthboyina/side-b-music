# Munna’s Grooves

[Open the shared dashboard](https://navakanthboyina.github.io/side-b-music/)

One listening room, no sign-in: everyone sees the same saved mix and can rate individual songs. GitHub Pages serves the frontend. Cloudflare Workers + D1 store the room and run discovery. Current build: **familiar-language-option-1**.

## Current recommendation flow

1. Read playlist songs, song ratings, recent recommendations and aggregated preview activity from D1. Prefer explicit liked songs as references; playing a preview is only weak feedback, not an automatic like.
2. Last.fm supplies similar tracks. The official ListenBrainz dataset API supplies additional related recordings after an exact MusicBrainz seed lookup. Either provider can fail independently. Last.fm requires the existing API key and public-use approval; ListenBrainz requires no visitor account.
3. Merge and normalize real candidates. MusicBrainz IDs resolve known recording aliases; mastering suffixes are deduplicated conservatively. Live, remix, acoustic and translated versions are not blindly merged. Missing identities remain text-matched; canonical resolution is best-effort, not universal.
4. For fresh discovery, exclude seeded/rated songs and recommendations from the previous **two days**. If fewer than 12 qualify, fill remaining slots from liked songs first, then Already know songs. This fallback may reuse recent songs; disliked songs, duplicate recordings and language mismatches stay blocked. Returning songs are labeled explicitly. Unrated songs may return after that window. Language-specific selections require supported lyrics-language metadata; unknown-language discoveries are permitted only in Mixed. The optional “Allow familiar songs with unverified language to fill gaps” checkbox permits unknown-language liked/known songs as clearly labeled fallback, never confirmed wrong-language or disliked songs. It is off by default. Artist nationality and storefront country are never language proof.
5. Deterministic scoring uses provider similarity, reference-song likes, weak preview feedback, novelty and exposure. Diversity limits keep at most two songs per artist, reference and known release. Language balancing prefers variety among eligible songs; it cannot guarantee equal representation.
6. When a complete 12-song selection exists, send a verified shortlist of at most 24 candidates to `@cf/google/gemma-4-26b-a4b-it`. The bounded provider chain returns 12 unique candidate IDs. Metadata, language, blocking, identity and diversity remain server-controlled. Invalid IDs, a timeout, unavailable AI or quota exhaustion retain the deterministic selection. AI never invents songs or supplies their descriptions.
7. Resolve selected songs against Apple/iTunes India, then US. Deezer remains an optional preview fallback to preserve working playback. Show YouTube search only when no usable preview is returned. A search result's provider ID is verified before the same Apple-first chain runs.
8. Cache provider mappings, metadata and preview URLs in D1, never audio. Use Cover Art Archive for a known MusicBrainz release when Apple artwork is absent. Catalog and artwork failures do not veto a valid batch.
9. Save one shared batch: **six songs per day for two days**. If fewer than 12 qualify, preserve the visible batch and retain the approved draft. Do not fill gaps with unrelated or unverified songs.

No audio analysis takes place. Descriptions state the discovery connection, not unverified tempo, instruments, lyrics, or mood claims. AI only runs during batch generation or an explicit owner diagnostic probe. The daily scheduled job warms discovery metadata without generating a new batch or calling AI.

## Feedback and playback

Like, Not for us, Already know and Clear affect individual songs. The latest shared rating replaces the previous one; this is not voting. Likes provide stronger references; disliked songs remain excluded. Liked and Already know songs can return only when fresh matches cannot fill the batch. Comfort mixes rotate daily and can be shuffled manually.

Actual preview playback records aggregate starts, reaching 15 seconds, and early stops under 10 seconds. A lookup alone is not counted as listening. Events are idempotent and rate-limited. They never overwrite explicit ratings. No visitor accounts or listening profiles are created.

## Upgrade the existing room

From your existing `backend` folder:

```bash
git pull --ff-only origin main
npm run db:migrate
npm run deploy
npm run diagnose
```

Migration `0002_resources_activity.sql` adds cache/activity tables. **Do not recreate the database or re-import the 533 songs.** Existing playlists, ratings, visible batch and compatible unexpired draft remain. Keep your existing D1 database ID in `backend/wrangler.jsonc` and your existing Cloudflare secrets. No new paid service or API key is required for the fixes. Optional AI fallback providers require their own keys.

Reload the website after deployment. The build in diagnostics must be `familiar-language-option-1`. The public backend URL remains in `shared-config.js`.

For a new installation, see [backend setup](backend/README.md).

## One diagnostic command

```bash
npm run diagnose
```

Wait for “Live Worker events confirmed”, then click Refresh **once** and try one preview. Let the three-minute capture finish. Share its **after** snapshot and `munna-preview` events; the **before** snapshot describes the prior attempt.

- `discovery.eligibility`: unknown/other languages, rated/excluded songs, duplicates and capped references.
- `discovery.requestsByProvider`: where the shared discovery budget went.
- `ratedFallback`: eligible liked/known songs, added count, blocked aliases and language exclusions.
- `pools[].ranking.filtered`: deterministic rejection reasons.
- `ai.mode`: `ai-reranked` or `deterministic`; `fallbackReason` explains AI failures.
- `catalog`: bounded post-selection enrichment requests/cache hits/errors.
- `munna-preview`: Apple storefront, HTTP status, identity-match count, missing-preview outcome, Deezer fallback and cache hits. No search query or media URL is logged.

Reports are saved under `backend/.diagnostics/` (gitignored). Raw provider keys and full taste profiles are not logged.

## Free-tier and provider limits

Keep the Cloudflare account on Workers Free for hard allowance limits rather than paid overages. Workers AI has a free daily allocation; this does **not** mean unlimited AI, requests or D1 capacity. Deterministic fallback covers AI failures, not an exhausted Worker/D1 allowance.

Refresh retains the 60-second cooldown, generation lease and 30-attempt UTC daily limit. Discovery uses at most 24 requests per refresh, MusicBrainz spacing, bounded caches and provider backoff. Last.fm is capped at six requests across all pools. For language-filtered discovery, a backlog of at least 12 unchecked cached tracks gets metadata priority before new similar-track queries. Catalog enrichment has a separate 12-request/20-second budget. Apple calls across preview/search/refresh share an 18-per-minute room budget. Upstream 429/503 responses pause that provider across all browsers for at least five minutes (longer if Retry-After requires it). Diagnostics distinguish upstream failures, shared-room limits and cooldown skips. Other preview providers remain available; a successful fallback preview stays cached even if Apple failed. Preview URLs and metadata are cached for up to six hours, misses briefly, with Cache-Control restrictions respected. Media is streamed directly from providers and never downloaded to D1.

ListenBrainz algorithm names and provider coverage can change. `LISTENBRAINZ_ALGORITHM` can override the documented dataset algorithm; `LISTENBRAINZ_ENABLED=false` disables that secondary source. Outages or missing language metadata can still leave a draft incomplete. Unknown language is never guessed to force 12 results.

## Validation

```bash
node --test tests/*.test.mjs
npm run test:runtime --prefix backend
npm run check --prefix backend
# With jsdom installed:
node tests/preview-ui.cjs
node tests/shared-ui.cjs
```

Tests cover AI quota/timeout/invalid-ID fallback, canonical deduplication, ratings/recent-language rules, Last.fm/ListenBrainz failures, cached Apple-first previews, shared-room behavior and actual playback activity. Runtime fixtures exercise Cloudflare workerd, but do not prove live provider coverage or production free-tier CPU compliance. Run the deployment diagnostic to verify those.

## Provider references

- [Gemma 4 on Workers AI](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/)
- [Workers AI free allocation](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [ListenBrainz official similar-recordings service](https://labs.api.listenbrainz.org/similar-recordings)
- [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API)
- [Cover Art Archive API](https://musicbrainz.org/doc/Cover_Art_Archive/API)
- [Apple Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/Searching.html)

Last.fm attribution is displayed for its discoveries. Apple previews retain the iTunes attribution and linked Download on iTunes badge. Provider artwork remains subject to its owners' rights. No unofficial Shazam, Spotify or JioSaavn API is required.

### Optional ranking providers

Groq GPT-OSS 120B and Gemini Flash-Lite can follow Gemma before deterministic fallback. They are disabled until the owner configures free-tier credentials and confirms account settings. See [activation and data-use details](backend/README.md#optional-ai-fallback-chain). Extra AI services do not resolve missing language metadata or catalog rate limits.

The familiar-language option applies to the next refresh. It preserves a compatible unfinished draft. Changing back to strict mode removes unverified familiar entries from a resumed draft. This does not guess or overwrite a song’s language. `ratedFallback` separates `unknownLanguage`, `otherLanguage`, and `unverifiedAdded`. CPU diagnostics inspect explicit outcome/exception/error fields, never a broad search across preview JSON.
