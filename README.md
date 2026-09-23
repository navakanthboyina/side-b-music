# Munna’s Grooves — Personal music discovery dashboard

A standalone static dashboard (no build step) designed for a **new GitHub repository**. No existing repository is required or modified.

## Free AI mode

1. Open Discover and select **AI picks — Lightweight AI**.
2. Like a few individual songs in Discover or the listening plan. No import is required. Playlist URLs alone do not give the AI your playlist contents.
3. Press **Refresh picks** to download/load the model and generate recommendations. Use **Stop AI** to cancel.

AI runs on the visitor’s device using Qwen2.5-0.5B-Instruct (4-bit) and WebLLM 0.2.85. There is no paid API, server bill for inference, API key, or provider account. The initial model weights are roughly 280 MB; allow extra storage for runtime/tokenizer files and around 1 GB of GPU memory. This lightweight model reduces storage use but may have weaker music knowledge than the previous 3B model. WebGPU with shader-f16 is required. Device support and speed vary. Model files are cached by WebLLM when browser storage permits; eviction can require another download. Downloads and local computation still consume data, battery, and device resources.

The app retrieves up to 20 real catalog candidates before starting AI. Rated songs and tracks shown in the last 14 days are excluded before selection. Catalog sources rotate among the starter artists, explicit artist seeds and artists credited on liked songs (imports are excluded from this AI path). A liked song is a source for candidate discovery, not a blanket positive rating on its artist. The local model selects up to six numeric candidate IDs based on individual song feedback. Returned IDs map back to unchanged catalog records; the model cannot invent titles, credits, labels or historical explanations. Candidate directions still depend on this bounded catalog pool, and are not audio similarity measurements.

If the model returns no valid IDs, one corrective retry is allowed. It never silently falls back to random picks labeled AI. Catalog exhaustion reports that explicitly while preserving the no-repeat rule.

Song feedback uses normalized artist credits plus title as its identity. Like, Not for me, Already know and Undo affect only that song across cards and reloads. Negative feedback never excludes the whole artist. Older artist ratings remain in backups but are ignored because they cannot be reliably converted into song ratings. The most recent positive and negative song ratings form a bounded AI prompt; all rated songs are excluded from new AI discovery results. Skipped/known songs are excluded in Catalog mode too.

Automatic Spotify playlist sync is not implemented. The website has no Spotify OAuth app or authorization; the ChatGPT Spotify connection does not grant this site API access. Spotify’s developer policy restricts feeding Spotify Content into ML/AI models (https://developer.spotify.com/policy). Existing optional playlist imports remain available for the rule-based Catalog mode and are excluded from AI prompts. AI personalization now uses song feedback submitted on this dashboard, without requiring imported files.

AI runs **only after a click**, never as a background job or automatic large download. Saved picks remain on reopen; press Refresh picks for another AI batch. Model inference stays local, while the WebLLM library, model weights and runtime come from jsDelivr, Hugging Face and MLC’s model-library host. Selected artist search terms go to Apple’s iTunes API. Playback/search links go to YouTube, SoundCloud or Bandcamp when opened. No full taste profile is sent to an AI server.

Unsupported devices and failed downloads show an error and preserve existing results. Users may explicitly choose **Catalog picks — no AI**; no rule-based results are silently labeled AI. Both modes retain 14-day song exclusions.

Model: https://huggingface.co/mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC

WebLLM: https://webllm.mlc.ai/docs/user/get_started.html

## Features

- Two-week plan with 12 discovery artists, track search links, and explored checkboxes.
- Two ordered comfort mixes.
- Live song recommendations: public iTunes Search API metadata queried through its documented JSONP interface. Playback/search links use YouTube, SoundCloud, and Bandcamp.
- Individual song likes, dislikes and Already know feedback; no artist-wide rating effects.
- CSV or pasted-track imports from the three specified Spotify playlists. **No Spotify track access or background sync is claimed.**
- Device-local profile and progress, with validated JSON backup/restore.
- Mobile layout, keyboard navigation, loading/error/empty states, and optional WebMCP song-rating tool.

## Run locally

```sh
python3 -m http.server 8080
```

Open http://localhost:8080. No package install or build step is needed.

## Enable GitHub Pages

The dashboard files are in the root of this repository.

1. Open [Settings → Pages](https://github.com/navakanthboyina/side-b-music/settings/pages).
2. Under Build and deployment, select **Deploy from a branch**.
3. Select **main** and **/ (root)**, then click **Save**.
4. GitHub displays the published website link when deployment completes.

Once enabled, future commits to `main` automatically republish the dashboard.

Do not upload local backups, imported playlist CSV files, or credentials. Ratings are stored in the viewer's browser, not the repository. Public hosting includes the three playlist links and starter plan.

## Recommendation behavior and limits

The starter profile is deliberately provisional: only the English, Telugu, Hindi, and Tamil language mix was confirmed. No listening-history ranking is used. Live queries return songs by selected seed artists, not a claim of previously unknown artists or newly released songs. Artist identity is matched against catalog credits to avoid unrelated search results. Repeated titles within an artist's results are removed.

In Catalog mode, the app chooses up to three artist search seeds and up to three tracks per seed. Imported and explicitly added artists receive extra weight. Song likes do not boost every song by that artist; AI mode is the song-similarity path. Language/mood filters in Catalog mode describe the seed, not every returned track. Imported artists with unknown classification appear under All languages / Any mood.

In Catalog mode, live metadata is fetched on visits after 24 hours or on manual refresh. AI mode generates only on manual refresh. There is no background job running while the dashboard is closed. When live lookup fails, an explicit unavailable state is shown; the fixed plan and comfort mixes remain accessible. The app does not use a paid API, secret key, embedded Apple artwork, Apple audio previews, or Spotify OAuth.

Profile data and recommendation history are saved in browser localStorage. Browsers/devices do not sync. CSV supports quoted fields, embedded newlines, comma/semicolon/tab delimiters, and Artist Name(s)/Track Name or Artist/Title headers. Multiple artist names separated by semicolons become independent seeds. Imports merge by normalized artist, title, and playlist source. Files are limited to 2 MB and the profile to 10,000 songs. Restore validates before replacing the current profile and asks for confirmation.

Catalog service documentation: https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/Searching.html

GitHub Pages documentation: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

## Two-week repeat prevention

Fresh catalog picks exclude previously displayed songs for a rolling **14 days**, using normalized artist credits and song title. Artist searches rotate through the least recently queried eligible seeds before using preference scores. History and the rotation counter persist in browser storage and are included in new backups; older backups remain compatible. Only unexpired history is retained.

Within-batch duplicates are removed, including tracks returned by multiple artist queries. If selected artists have no unseen tracks, the feed explains this instead of falling back to repeated starter songs. Another refresh can search the next artists. API failures show an explicit unavailable state. Existing cached picks may remain visible on reopen; pressing Refresh generates a new batch and excludes them. The fixed plan, featured starter, and comfort queues are not subject to the exclusion.

The previous release did not record exposure history. On upgrade, only its latest cached batch can be migrated. Other older exposures cannot be reconstructed. History is device/browser-local: clearing storage or using a new device resets it unless a current backup is restored.


## Checks

Run `node --test tests/*.test.mjs` for song-based AI parsing, preference filters, unsupported-device handling, and cancellation tests. These use a mocked worker; they do not validate on-device model quality or GPU performance.

Song-feedback UI regression: install the test-only dependency with `npm install --no-save jsdom`, then run `node tests/song-feedback.cjs`. It checks same-artist song independence, reloads, undo, old-rating migration and exact song matching with mocked AI/catalog responses. No dependency is needed to serve the dashboard.


## AI storage recovery

The previous 3B model could exceed browser cache quotas. Lightweight AI replaces it with a 0.5B model. On first load, the worker removes only cached files whose URLs belong to the previous model and its runtime. The **Clear AI downloads** button removes downloadable files for both dashboard model versions, including partially downloaded shards. It does not clear localStorage, song feedback, imports, history, or unrelated model/application files. Quota failures give recovery instructions rather than suggesting a paid subscription. Free disk space and browser storage policies can still prevent loading; hardware inference remains device-dependent.

AI output formatting is requested in the prompt and validated by `parseSongs`. The worker intentionally does not set WebLLM `response_format`: its JSON grammar matcher failed during initialization on a reported device. Malformed responses still produce an explicit error, and invalid/unverified songs are not displayed. This change does not delete cached model weights or user feedback.

AI failures now expose opt-in diagnostic details on the page: generated response, model version, selected filters and rejection counts. The full taste profile is omitted; diagnostics stay in the page and are not uploaded or persisted. This aids device-specific diagnosis; mocked tests do not establish successful on-device inference.

Label validation regression: the reported model copied the pipe-separated label options from the prompt. The prompt now shows single example values and separate allowed choices. Invalid or ambiguous labels become Unspecified / Any mood. They are accepted only when the corresponding filter is unrestricted; explicit language/mood filters still exclude unknown values. An equivalent fixture with fictional songs is covered by `tests/reported-labels.test.mjs`. Model-generated fit explanations remain unverified estimates.

Candidate selection accepts numeric IDs, objects with IDs, or arrays of artist/title objects (including a `songs` wrapper). Named songs must match a supplied eligible candidate by normalized full credits and title. Model-provided ratings, explanations and metadata are ignored; saved feedback is never changed by AI output. Diagnostics distinguish already-rated/recent songs, songs outside the candidate pool, and malformed selections.

Mixed listening: two weeks of six starter songs, with languages interleaved. Discover always mixes languages and requests 12 AI selections from up to 24 unseen catalog candidates. Actual AI batch size can be smaller when the model selects fewer eligible songs; no rule-based filler is labeled AI. Catalog mode requests up to 12 songs. Existing feedback and 14-day exclusions are preserved.

## Shared room (deployment ready)

The `backend/` Worker and `shared-app.mjs` implement one shared batch and shared song feedback with no visitor accounts. Server-side AI removes the WebGPU requirement for visitors. See [backend/README.md](backend/README.md) for free-tier deployment, owner-only playlist setup, behavior, and validation. Until the owner deploys the backend and sets the public `apiBase` in `shared-config.js`, the existing browser-local dashboard remains active. No playlist CSVs or credentials are committed.
