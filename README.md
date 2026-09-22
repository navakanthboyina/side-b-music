# Munna’s Grooves — Personal music discovery dashboard

A standalone, dependency-free static dashboard designed for a **new GitHub repository**. No existing repository is required or modified.

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

The app chooses up to three seeds and up to three tracks per seed. Replay ratings increase that artist and matching starter moods; Skip excludes an artist from fresh picks; Known reduces its priority. Imported and explicitly added artists receive extra weight. A daily hash and manual-refresh counter vary the selection. Language/mood filters describe the seed, not the language or mood of every returned track. Imported artists with unknown classification appear under All languages / Any mood; an explicit artist seed can assign a language.

Live metadata is fetched on visits after 24 hours or on manual refresh. There is no background job running while the dashboard is closed. When live lookup fails, starter results remain available with an explicit message. The app does not use an LLM, paid API, secret key, embedded Apple artwork, Apple audio previews, or Spotify OAuth.

Data stays in browser localStorage. Browsers/devices do not sync. CSV supports quoted fields, embedded newlines, comma/semicolon/tab delimiters, and Artist Name(s)/Track Name or Artist/Title headers. Multiple artist names separated by semicolons become independent seeds. Imports merge by normalized artist, title, and playlist source. Files are limited to 2 MB and the profile to 10,000 songs. Restore validates before replacing the current profile and asks for confirmation.

Catalog service documentation: https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/Searching.html

GitHub Pages documentation: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
