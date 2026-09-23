# Munna’s Grooves — Personal music discovery dashboard

A standalone static dashboard (no build step) designed for a **new GitHub repository**. No existing repository is required or modified.

## Free AI mode

1. Open Discover and select **AI picks — local model**.
2. Import playlist tracks or add favorite artists under Your taste. Playlist URLs alone do not import songs.
3. Press **Refresh picks** to download/load the model and generate recommendations. Use **Stop AI** to cancel.

AI runs on the visitor’s device using Qwen2.5-3B-Instruct (4-bit) and WebLLM 0.2.85. There is no paid API, server bill for inference, API key, or provider account. The initial model weights total about 1.74 GB; allow roughly 2 GB for download/cache and around 3 GB of available GPU memory. WebGPU with shader-f16 is required. Device support and speed vary. Model files are cached by WebLLM when browser storage permits; eviction can require another download. Downloads and local computation still consume data, battery, and device resources.

The LLM proposes up to three artists and explains the fit using a bounded sample of imported tracks, common playlist artists, added favorites, ratings, and current filters. Suggestions are matched to artist credits in the iTunes catalog before displaying up to three tracks per artist. Song selection within those artists still uses catalog rules; the AI does not listen to audio. Language, mood and fit explanations are model estimates and can be wrong. Sparse profiles are explicitly treated as provisional.

AI runs **only after a click**, never as a background job or automatic large download. Saved picks remain on reopen; press Refresh picks for another AI batch. Model inference stays local, while the WebLLM library, model weights and runtime come from jsDelivr, Hugging Face and MLC’s model-library host. Selected artist search terms go to Apple’s iTunes API. Playback/search links go to YouTube, SoundCloud or Bandcamp when opened. No full taste profile is sent to an AI server.

Unsupported devices and failed downloads show an error and preserve existing results. Users may explicitly choose **Catalog picks — no AI**; no rule-based results are silently labeled AI. Both modes retain 14-day song exclusions.

Model: https://huggingface.co/mlc-ai/Qwen2.5-3B-Instruct-q4f16_1-MLC

WebLLM: https://webllm.mlc.ai/docs/user/get_started.html

## Features

- Four-week plan with 12 discovery artists, track search links, and explored checkboxes.
- Two ordered comfort mixes.
- Live song recommendations: public iTunes Search API metadata queried through its documented JSONP interface. Playback/search links use YouTube, SoundCloud, and Bandcamp.
- Artist, language, and mood priorities adjusted by Replay, Skip, and Already familiar ratings.
- CSV or pasted-track imports from the three specified Spotify playlists. **No Spotify track access or background sync is claimed.**
- Device-local profile and progress, with validated JSON backup/restore.
- Mobile layout, keyboard navigation, loading/error/empty states, and optional WebMCP artist-rating tool.

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

In Catalog mode, the app chooses up to three seeds and up to three tracks per seed. Replay ratings increase that artist and matching starter moods; Skip excludes an artist from fresh picks; Known reduces its priority. Imported and explicitly added artists receive extra weight. A daily hash and manual-refresh counter vary the selection. Language/mood filters describe the seed, not the language or mood of every returned track. Imported artists with unknown classification appear under All languages / Any mood; an explicit artist seed can assign a language.

In Catalog mode, live metadata is fetched on visits after 24 hours or on manual refresh. AI mode generates only on manual refresh. There is no background job running while the dashboard is closed. When live lookup fails, an explicit unavailable state is shown; the fixed plan and comfort mixes remain accessible. The app does not use a paid API, secret key, embedded Apple artwork, Apple audio previews, or Spotify OAuth.

Profile data and recommendation history are saved in browser localStorage. Browsers/devices do not sync. CSV supports quoted fields, embedded newlines, comma/semicolon/tab delimiters, and Artist Name(s)/Track Name or Artist/Title headers. Multiple artist names separated by semicolons become independent seeds. Imports merge by normalized artist, title, and playlist source. Files are limited to 2 MB and the profile to 10,000 songs. Restore validates before replacing the current profile and asks for confirmation.

Catalog service documentation: https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/Searching.html

GitHub Pages documentation: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

## Two-week repeat prevention

Fresh catalog picks exclude previously displayed songs for a rolling **14 days**, using normalized artist credits and song title. Artist searches rotate through the least recently queried eligible seeds before using preference scores. History and the rotation counter persist in browser storage and are included in new backups; older backups remain compatible. Only unexpired history is retained.

Within-batch duplicates are removed, including tracks returned by multiple artist queries. If selected artists have no unseen tracks, the feed explains this instead of falling back to repeated starter songs. Another refresh can search the next artists. API failures show an explicit unavailable state. Existing cached picks may remain visible on reopen; pressing Refresh generates a new batch and excludes them. The fixed plan, featured starter, and comfort queues are not subject to the exclusion.

The previous release did not record exposure history. On upgrade, only its latest cached batch can be migrated. Other older exposures cannot be reconstructed. History is device/browser-local: clearing storage or using a new device resets it unless a current backup is restored.


## Checks

Run `node --test tests/ai.test.mjs` for AI parsing, preference filters, unsupported-device handling, and cancellation tests. These use a mocked worker; they do not validate on-device model quality or GPU performance.
