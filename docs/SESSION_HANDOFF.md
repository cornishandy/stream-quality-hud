# Session handoff

## State (19 Oct 2026)
- 1.6.0 (20 Oct 2026), installed on Andy's Mac: the Safari userscript loads on the next page load; Chrome's unpacked copy is updated on disk and takes effect when the extension is reloaded.
- 89/89 tests pass (`tools/serve-fixtures.sh`, then `npm test`).
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
   - **Chrome:** reload the unpacked extension on `chrome://extensions`.
   - **Safari:** copy `dist/stream-quality-hud.user.js` into the Userscripts folder, then reload the video page.

## Resume prompt
> Continue the Stream Quality HUD in ~/Documents/ChatGPT/stream-quality-hud. Read README.md and docs/DECISIONS.md first. Keep the rules: verdicts only from exact evidence, no background requests, never touch audio. Run the tests before and after any change.
