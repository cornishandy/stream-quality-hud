# Session handoff

## State (22 Oct 2026)
- 1.9.0 (22 Oct 2026): playback first; visible grades or evidence reason; plain sound; one technical disclosure; scroll preserved. 102/102 browser integration checks plus 48/48 overview checks pass. Astra final gate, Gemini visual review and Grok code/scroll review approved. Installed in Safari and Chrome; live Safari overview and Chrome runtime version verified.
- 1.8.0 (21 Oct 2026): streaming grade beside the disc grade; Details stays reachable in short windows. Pushed.
- 1.7.0 (21 Oct 2026): data grade, overlays, sound the player picks, and lines that hold still. Pushed 21 Oct 2026.
- Installed copies on Andy's Mac are now 1.9.0. Chrome was still running 1.6.0 from its separate unpacked folder before this update; both the folder and runtime were explicitly updated and verified.
- 150/150 checks pass (102 integration + 48 overview) (`tools/serve-fixtures.sh`, then `npm test`).
- Moved out of a scratch folder into this repo on 19 Oct 2026, with no code changes. The userscript rebuilt byte-identical.

## History
- **18 Oct 2026:**
  - 1.0 to 1.2: first build and two review rounds. These set the exact-evidence rules and removed background fetches.
  - 1.3: Safari userscript and published per-service caps.
  - 1.4: refresh rate and smoothness.
  - 1.5: redesign with a verdict, judged rows, and a sound section.
- **19 Oct 2026:** published as its own repo. Its companion, [movie-sound](https://github.com/cornishandy/movie-sound), handles the audio side. 1.6.0 replaces the corner cue and the top verdict with the compact scorecard: a pill, three marked rows, and Details.

## How to change it
1. Edit `extension/hud.js`; if a service's caps change, update `docs/SERVICES.md` or `docs/SOUND.md` too.
2. Bump the version in `extension/manifest.json` and `package.json`.
3. Run `tools/serve-fixtures.sh`, then `npm test`.
4. Run `tools/build-userscript.sh`.
5. Reinstall:
   - **Chrome on Andy’s Mac:** copy changed extension files to `~/Library/Application Support/chrome-unpacked-extensions/stream-quality-hud/`, then reload on `chrome://extensions` and verify the shown version. Chrome loads that separate copy, not this repository.
   - **Safari on Andy’s Mac:** copy `dist/stream-quality-hud.user.js` to `~/Library/Containers/com.userscripts.macos.Userscripts-Extension/Data/Documents/scripts/`, then reload the video page.

## Resume prompt
> Continue the Stream Quality HUD in ~/Documents/ChatGPT/stream-quality-hud. Read README.md and docs/DECISIONS.md first. Keep the rules: verdicts only from exact evidence, no background requests, never touch audio. Run the tests before and after any change.
