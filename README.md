# Munna’s Grooves

[Open the dashboard](https://navakanthboyina.github.io/side-b-music/)

One shared listening room, with no visitor sign-in. Everyone sees the same saved recommendations and can rate individual songs. GitHub Pages serves the frontend; Cloudflare Workers, D1 and Workers AI handle shared taste, recommendations and feedback.

## How recommendations work

- The owner imports playlist CSVs with `Artist Name(s),Track Name` or `Artist,Title` headers, maximum 2 MB each.
- Up to 16 representative playlist songs and explicit liked songs provide song-level taste references. Likes take priority. Rated songs are excluded from new discoveries; skips are negative evidence, and Already know is exclusion only.
- Catalog queries use credits from those references. Results must match those credits; Deezer fallback resolves an exact artist ID before fetching tracks. Broad unrelated search hits are rejected.
- Llama 3.2 3B compares real candidates with specific reference songs and recent individual feedback. It returns a fit score for each supplied candidate/reference pair. These estimates are not audio measurements or guaranteed similarity.
- Every description names a validated reference song, says whether it was liked or in the playlist, and says that musical fit is a metadata-based estimate. Descriptions are built from verified reference data rather than model-written claims about instruments, tempo, or mood. There is no generic claim that every song matches the entire community.
- Up to 12 accepted songs, at most two per credited artist, are saved. Fewer are allowed when matches are weak. The current candidate pool emphasizes artists and collaborators already represented in taste; new-artist discovery is limited.
- Songs shown within 14 days, playlist-familiar songs and rated songs are excluded. The saved batch is split across two weeks, with all languages mixed.

Playback stays on YouTube, SoundCloud or Bandcamp through search links. The comfort mixes are fixed curated lists, not live AI recommendations.

## Shared feedback and refresh

Like, Not for us, Already know and Clear apply to individual songs. The latest visitor rating replaces the previous shared rating for that song; this is not voting. Feedback affects the next generation, not the currently saved batch. Browsers sync on focus or within 60 seconds while visible.

Refresh is manual, with a 60-second cooldown and a room-wide limit of 30 attempts per UTC day. Provider allowances may limit usage earlier. Existing valid picks remain if generation fails. No invented songs or unrelated fallback tracks fill empty slots.

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
