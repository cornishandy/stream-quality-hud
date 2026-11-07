# Stream Quality HUD

A small panel over streaming video that shows what is playing, compares its data with high streaming and disc references, and flags supported playback issues. It works in Chrome as an extension and in Safari as a userscript.

![The compact HUD with streaming and disc grades](screenshots/compact-grades.png)

Most streaming players never say which version they picked. Chrome often gets a lower tier than Safari on a Mac, and the player's own menu won't tell you. The HUD reads what the browser already knows about the video and the stream list the service sent, then puts the conclusion in plain words:

- **A button over the video** names the playing size, video codec and listed bitrate, such as `720p · H.264 · 3.0 Mbps`. Once five seconds of the playing video are committed and at least 90% of that watched time is covered, it names the running average instead, such as `6.1 Mbps avg`. Colour and channel layout stay in the panel, because SDR and stereo show up on every film here. An amber dot on the button is the only problem mark while the panel is closed. The button shows on a known service, or on a video of 10 minutes or more, and fades after 3 seconds of idle while the video plays. Click it, press **Control+Shift+H**, or use the toolbar button to open the panel.
- **Picture first:** decoded resolution and colour range, followed by two visible data grades. The Streaming grade compares this encode with a high streaming reference at the same size; Disc compares with a 1080p Blu-ray reference. Letters, meanings and percentages stay together. They estimate data generosity, not visible picture quality.
- **Measured video data, when the pieces can be read:** the average, the highest second, the range, and a bar of watched time. If the pieces cannot be read, the panel names why and shows no bitrate. Listed grades stay until two minutes of the current size and codec are measured.
- **When grades cannot be calculated**, the grade area names the missing input (video bitrate, frame rate or codec) instead of disappearing or guessing a letter.
- **Sound in plain words:** Stereo means left and right channels; AAC is the audio format. A codec alone never proves a channel count. Missing sound information leaves no empty overview row.
- **Relevant problems only:** the overview calls out a higher version actually sent for this video, a measured playback problem, or a page filter/solid obstruction. Static service ceilings, unsupported audio formats, normal overlays and processing caveats are in **Technical details**.
- **One disclosure:** observed technical values stay available without a legend, repeated “Normal” badges or blank measurements. The panel scrolls when needed, including short windows; refresh preserves its scroll position and the disclosure's focus.

[Interactive examples](docs/preview.html) show both a graded stream and the visible reason when the inputs are unavailable. These examples use synthetic track evidence.

## Install

**Chrome (or another Chromium browser)**
1. Download this repo (Code → Download ZIP) and unzip it.
2. Open `chrome://extensions`, switch on **Developer mode**, click **Load unpacked**, and pick the `extension` folder.
3. On a video page, press **Control+Shift+H** or click the toolbar button.

**Safari**
1. Install the free [Userscripts](https://apps.apple.com/app/userscripts/id1463298887) app and enable it in Safari → Settings → Extensions.
2. Put [`dist/stream-quality-hud.user.js`](dist/stream-quality-hud.user.js) in the Userscripts scripts folder, and allow Userscripts on every website.
3. Reload the video page and press **Control+Shift+H**.

**Comparing two browsers on one film.** Run `node tools/card-box.mjs` and leave that terminal open. It listens only on `127.0.0.1:9791` and stores cards in `~/Library/Caches/stream-quality-hud/`. It is not a login item. Open the same film in each browser. When both have a confirmed list, the panel says which one was sent the stronger copy, with a link where that browser has one. Reload the unpacked Chrome extension after this update so it can ask for the localhost permission.

## What it reads, and what it doesn't

- It only reads what the page already has: the `<video>` element, the browser's own playback stats, the stream lists (DASH `.mpd`, HLS `.m3u8`) the page downloaded, and which formats the browser says it can decode.
- **No permission to read websites.** To read a stream list, it asks the browser again for a list the page itself already downloaded, from inside the page with the page's own rights. The browser usually answers that from its cache. It never refetches a stream list in the background.
- **The pieces the player already appended.** In Chrome and Orion the reader runs in the page and counts those pieces. It does not request them. In Safari it runs only on services checked for it. Safari may send a site a CSP violation report the first time, if that site has started blocking inline scripts; the HUD then never tries there again.
- It does not analyse picture pixels, including on a protected stream.
- Safari's own HLS player, when the video source is an `.m3u8` file, cannot be read.
- A player that feeds Media Source from a background worker cannot be read.
- **One localhost exception, for comparing browsers.** The only host permission is `http://127.0.0.1:9791/*`. When you run `node tools/card-box.mjs`, each browser can save a short card for the film that is actually playing (site, path, browser, top size, codec, listed bitrate, colour, frame timing, whether the page alters the picture). The box stays on this Mac. It does not receive playlist URLs, segment URLs, cookies, or the list itself. If the box is not running, the panel keeps this browser's own card and does not recommend another browser. Safari reaches the box through the userscript's `GM_xmlhttpRequest` grant, not through a website permission.
- **It never touches sound.** It doesn't create an audio context and doesn't hook the audio path.
- **A verdict needs exact evidence:** the list the video itself is playing (its HLS source, or the list matching its own newest downloads since it started). Without that, it says it can't confirm, rather than guessing.
- **Per-service limits** (for example, Netflix sends Chrome up to 1080p and Safari up to 4K) come from each service's own help pages. Sources and quotes are in [docs/SERVICES.md](docs/SERVICES.md) and [docs/SOUND.md](docs/SOUND.md).

## Develop

- `extension/hud.js` is the panel. It also runs on its own, without extension APIs. `extension/page-hook.js` is the page-world reader. Chrome and Orion load both. The Safari userscript is built from both.
- `tools/build-userscript.sh` rebuilds `dist/stream-quality-hud.user.js`.
- **Tests:** 221 silent checks (173 integration and 48 overview/evidence checks), in headless Chromium (the real unpacked extension) and WebKit (the userscript). The card-box check runs first. Every fixture is a synthetic test pattern, and every sound track is digital silence.
  ```
  npm install            # or set PLAYWRIGHT_FROM to a folder that already has playwright-core
  tools/serve-fixtures.sh
  npm test
  ```

## Status

- [x] Chrome extension (Manifest V3), 1.13.1
- [x] Safari userscript, built from the same files
- [x] Current picture, measured video data when the pieces can be read, data grades, plain-language sound and technical details
- [x] Cross-browser film cards, compared only when both browsers saved one
- [x] Published caps for Netflix, Prime Video, Disney+, Hulu, Max, Apple TV+, Paramount+, Peacock, AMC+, MUBI and Criterion Channel
- [x] 221/221 checks (173 integration, 48 overview)
- [ ] Chrome Web Store listing (not planned)

See [docs/DECISIONS.md](docs/DECISIONS.md) for why it works the way it does.

## Licence

MIT
