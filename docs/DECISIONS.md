# Decisions

Why the HUD works the way it does. Newest first.

## 1.5 (18 Oct 2026): judged rows and a verdict, not raw numbers
- **A verdict headline replaces the green status text.** The old line ("Best size…") coloured a technical fact green, which didn't answer the real question: is this the best I can get here, and if not, where? The verdict now says that in words, worst problem first: not the best picture yet → best picture but not the best sound → best this browser gets, more elsewhere → best this site offers → can't confirm.
- **A cue dot carries the colour, not the text.** It sits in the top-right corner, where a projectionist's reel-change mark appears. Sage means best here, blue means more exists elsewhere, amber means not the best, and a hollow ring means can't confirm.
- **Every row is judged Normal, Unusual or Note, with a reason.** Only exceptions get colour (amber for Unusual), so a normal stream reads calm.
- **Sound got its own section:** the playing track (WebKit's track configuration, or the downloaded audio matched to the list), the list's best track and whether this browser says it can decode it, and each service's published sound limits.
- **"After this" row:** the HUD sits before any audio processing on the Mac, so it says what comes next (Movie Sound, a Chrome audio extension) and that it can't see it.
- **Refresh vs smoothness.** Safari draws web pages at about 60 Hz even on a 120 Hz screen (the video itself is drawn natively), while Chrome reports the screen's real rate. So "Refresh" is a note, and "Smoothness" is measured from `requestVideoFrameCallback` frame times (even or uneven pacing). WebKit reports when frames are due, not when they were shown, so there the HUD says "can't check here" rather than guess.

## 1.3–1.4: Safari, published caps, refresh rate
- **Safari runs it as a userscript** through the free Userscripts app. A real Safari extension needs Xcode and a signing identity, and a temporary developer extension disappears when Safari quits. `hud.js` already works without extension APIs, so the userscript is the same file with a header.
- **Published caps per service** (Netflix, Prime Video, Disney+, Hulu, Max, Apple TV+, Paramount+, Peacock, AMC+, MUBI, Criterion Channel), taken from each service's own help pages, with the source and quote for each in `SERVICES.md` and `SOUND.md`. Where a service publishes no browser cap, the HUD says so instead of inventing one.
- **Orion** (a WebKit browser that presents Chrome's user agent to extensions) is detected by WebKit-only APIs and named as Orion, with no service caps, since no service publishes one for it.

## 1.0–1.2: exact evidence only
Two independent code reviews (GPT-6.1-Sol, NO-GO twice) shaped these rules:
- **No background requests, no host permissions.** An early version fetched stream lists again from the extension's background, with access to every site. That's a privacy and security risk, so it was removed. Now the HUD only re-reads lists the page itself already downloaded, from inside the page with the page's own rights (usually from the browser's cache).
- **A verdict needs the video's own list.** That's either its HLS source, or the list whose segments match the video's newest downloads since it started playing. A trailer's list, a hidden second video, trick-play tracks or a multi-period DASH list can't certify "best".
- **The HUD never touches audio.** It creates no AudioContext and doesn't read channel counts through Web Audio, so turning it on or off can't change what you hear.
- **Toggle is Control+Shift+H.** Control+Option+Shift combinations are commonly taken by window managers.
- **A bare `<video>` in full screen can't show the panel.** Nothing can draw over it. Sites that put their whole player in full screen (most do) are fine.
