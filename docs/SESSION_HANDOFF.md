# Session handoff

## State (26 Oct 2026)
- 1.13.1 (26 Oct 2026, 1:55 AM): when nothing can be measured, the Measured block shows only the reason (no method notes). 175/175 integration plus 48/48 overview. Copied to the Chrome and Orion unpacked folders and the Safari Userscripts folder. Live checks before it (Andy, 26 Oct 1:17–1:26 AM): Prime Video in Safari plays HLS natively (the video's address is an .m3u8), so it says "Safari plays this stream itself", which is correct; Prime Video in Chrome measured real DRM playback (pill `1080p · H.264 · 9.0 Mbps avg`, highest second 16.5, range 1.1–16.5, 1080p 92% · 720p 8%). Open question: Chrome's measured streaming grade said about 140% of a high 1080p stream, about 1.6× what 9–10 Mbps H.264 at 1080p and 24 fps gives under STREAM_REF; the frame rate or the byte count going into the grade needs the Technical details from a live run.
- 1.13.0: measured video data from the pieces the player already appended. The panel shows the average, the highest second, the range, and a bar of watched time. The pill keeps the listed rate until 5 seconds are committed at 90% coverage, then shows the running average. Grades use that configuration's own watched interval after 120 seconds at 90% coverage. Unavailable cases name the reason and show no bitrate. Safari's reader is limited to the checked service list, and its block list is the userscript's GM storage. Safari may send a site a CSP violation report the first time, if that site has started blocking inline scripts; the HUD then never tries there again. `npm test`: card box passed, 173/173 integration, 48/48 overview. `dist/` rebuilt. Not copied to the Safari, Chrome, or Orion install folders. Browsers were not reloaded.
- 1.12.0: the top-right pill names size, video codec and listed bitrate (`720p · H.264 · 3.0 Mbps`). SDR and stereo stay in the panel. Browsers were not reloaded after this copy.
- 1.11.0: the top-right pill names the picture and the sound (`720p SDR · Stereo`). Problem titles stay in the open panel. The amber dot still marks a problem. A newer film card on this Mac is not replaced by an older copy from the loopback box. 120/120 integration plus 48/48 overview. Files copied to the Safari userscript folder and the Chrome and Orion unpacked folders; browsers were not reloaded.
- 1.10.0: a confirmed film card per browser, compared only when the other browser saved one for the same path. Loopback box `node tools/card-box.mjs` on 127.0.0.1:9791. 116/116 integration plus 48/48 overview. Files copied to the Safari userscript folder and the Chrome and Orion unpacked folders; browsers were not reloaded.
- 1.9.0 (22 Oct 2026): playback first; visible grades or evidence reason; plain sound; one technical disclosure; scroll preserved. 102/102 browser integration checks plus 48/48 overview checks pass. Astra final gate, Gemini visual review and Grok code/scroll review approved. Installed in Safari and Chrome; live Safari overview and Chrome runtime version verified.
- 1.8.0 (21 Oct 2026): streaming grade beside the disc grade; Details stays reachable in short windows. Pushed.
- 1.7.0 (21 Oct 2026): data grade, overlays, sound the player picks, and lines that hold still. Pushed 21 Oct 2026.
- 1.13.0 was copied to the Chrome and Orion unpacked folders and the Safari Userscripts folder on 26 Oct 2026, 1:12 AM, after Sol's code review, Astra's final gate and the lead's fixes for its last two findings (revoking a blob address keeps an attached reader; the replay backlog is capped at 3 MB across deliveries, encoded outside the player's call). 175/175 integration plus 48/48 overview. Browsers were not reloaded, and real-service playback (DRM, Disney+ in Safari) is not yet confirmed.
- Current check: 175/175 integration plus 48/48 overview (`tools/serve-fixtures.sh`, then `npm test`). The older 150/150 figure was 1.9.0.
- Moved out of a scratch folder into this repo on 19 Oct 2026, with no code changes. The userscript rebuilt byte-identical.

## History
- **18 Oct 2026:**
  - 1.0 to 1.2: first build and two review rounds. These set the exact-evidence rules and removed background fetches.
  - 1.3: Safari userscript and published per-service caps.
  - 1.4: refresh rate and smoothness.
  - 1.5: redesign with a verdict, judged rows, and a sound section.
- **19 Oct 2026:** published as its own repo. Its companion, [movie-sound](https://github.com/cornishandy/movie-sound), handles the audio side. 1.6.0 replaces the corner cue and the top verdict with the compact scorecard: a pill, three marked rows, and Details.

## How to change it
1. Edit `extension/hud.js` for the panel, and `extension/page-hook.js` for the page-world reader. If a service's caps change, update `docs/SERVICES.md` or `docs/SOUND.md` too.
2. Bump the version in `extension/manifest.json` and `package.json`.
3. Run `tools/serve-fixtures.sh`, then `npm test`.
4. Run `tools/build-userscript.sh`.
5. Reinstall:
   - **Chrome on Andy’s Mac:** copy changed extension files to `~/Library/Application Support/chrome-unpacked-extensions/stream-quality-hud/`, then reload on `chrome://extensions` and verify the shown version. Chrome loads that separate copy, not this repository.
   - **Safari on Andy’s Mac:** copy `dist/stream-quality-hud.user.js` to `~/Library/Containers/com.userscripts.macos.Userscripts-Extension/Data/Documents/scripts/`, then reload the video page.

## Resume prompt
> Continue the Stream Quality HUD in ~/Documents/ChatGPT/stream-quality-hud. Read README.md and docs/DECISIONS.md first. Keep the rules: verdicts only from exact evidence, no background requests, never touch audio. Run the tests before and after any change.
