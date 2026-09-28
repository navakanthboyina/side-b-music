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
