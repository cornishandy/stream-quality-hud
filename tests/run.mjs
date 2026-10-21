#!/usr/bin/env node
// Silent end-to-end checks for the Stream Quality HUD. Every test video is muted; the only sound tracks in the
// fixtures are digital silence (dash/*-3*.m4s, hlsnativeaudio), and Chromium also runs with --mute-audio.
// Needs the fixture servers: tools/serve-fixtures.sh (8794 = page origin, 8795 = "CDN" without CORS, reached as cdn.test).
// Needs playwright-core: `npm install`, or set PLAYWRIGHT_FROM to a folder whose node_modules already has it.
// Chromium loads the real unpacked extension; WebKit runs hud.js as an init script with a stub chrome API.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(process.env.PLAYWRIGHT_FROM ? path.join(path.resolve(process.env.PLAYWRIGHT_FROM), 'x.js') : import.meta.url);
const { chromium, webkit } = require('playwright-core');
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../extension');
const BASE = 'http://127.0.0.1:8794/';
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n     ' + detail.replace(/\n/g, '\n     ')));
};

const hudText = (page) =>
  page.evaluate(() => {
    const h = document.querySelector('[data-stream-quality-hud]');
    if (!h || !h.isConnected) return null;
    const p = h.shadowRoot.querySelector('.p');
    if (!p || p.hidden) return null;
    return p.innerText;
  });

async function openDetails(page) {
  await page.evaluate(() => {
    const h = document.querySelector('[data-stream-quality-hud]');
    const d = h && h.shadowRoot.querySelector('details');
    if (d && !d.open) d.querySelector('summary').click();
  });
}

async function open(page, url) {
  await page.goto(BASE + url);
  if (url.startsWith('mse')) await page.waitForFunction(() => document.title === 'playing' || document.title.startsWith('error'), null, { timeout: 15000 });
  await page.waitForTimeout(2500);
  await page.keyboard.press('Control+Shift+KeyH');
  await page.waitForTimeout(200);
  await openDetails(page);
  await page.waitForTimeout(1200);
  if (url === 'plain.html') await page.waitForFunction(() => {
    const root = document.querySelector('[data-stream-quality-hud]')?.shadowRoot;
    const rows = [...(root?.querySelectorAll('.det .row') || [])];
    const smoothness = rows.find(r => r.querySelector('.k').textContent === 'Smoothness');
    return smoothness && smoothness.querySelector('.v').textContent !== 'measuring…';
  }, null, { timeout: 3000 });
  return hudText(page);
}

const B = '(Chrome|Safari)';
const cases = [
  ['DASH, 720p playing', 'mse.html?rep=1', [/720p(?: SDR)? · 127\.0\.0\.1 sent (Chrome|Safari) up to 1080p/, /players start low; give it a minute/, /matched to its downloads/, /Playing\s+1280×720 \(720p\), H\.264/, /Top sent\s+1920×1080, H\.264, 6\.0 Mbps/, /3 versions, all SDR \(DASH\)/, /Bitrate\s+3\.0 Mbps listed/]],
  ['DASH, 1080p playing', 'mse.html?rep=2', [/1080p(?: SDR)? · top of 3 sent to (Chrome|Safari)/, /Source\s+adaptive stream \(Media Source\)/]],
  ['data grade: 6 Mbps H.264 at 1080p, 24 fps', 'mse.html?rep=2', [/1080p(?: SDR)? · top of 3 sent to (Chrome|Safari) · grade C \(typical streaming; about 20% of a Blu-ray’s data\)/, /Data grade\s+C · 0\.121 bits per pixel[^\n]*typical streaming; about 20% of a Blu-ray’s data[^\n]*\nNormal/, /Overlays\s+none found[^\n]*\nNormal/]],
  ['a player shade and subtitles are listed over the video', 'mse.html?rep=2&overlay=1', [/Over the video: shading over 37%, up to 60% dark; subtitles\./, /Overlays\s+shading over 37%, up to 60% dark; subtitles[^\n]*\nNote/]],
  ['a filter on the video is called out', 'mse.html?rep=2&filter=1', [/Over the video: video filter brightness\(0\.8\)\./, /Overlays\s+video filter brightness\(0\.8\)the page changes the picture itself\nUnusual/]],
  ['DASH film plus a trailer list: downloads pick the film', 'mse.html?rep=1&trailer=1', [/720p(?: SDR)? · 127\.0\.0\.1 sent (Chrome|Safari) up to 1080p/, /matched to its downloads/, /\(DASH\)/]],
  ['HLS list seen but not this video’s: no verdict', 'hls.html', [/no stream list confirmed as this video’s/, /Stream lists\s+1 \(best in them: 4K\)/]],
  ['plain file, no list', 'plain.html', [/no stream list seen/, /Playing\s+1920×1080 \(1080p\)/, /On screen\s+\d+×\d+ px/, /(?:about original size|, enlarged|, shrunk)/, /Dropped\s+\d+ of/, /Refresh\s+\d+ Hz/, /Smoothness\s+(even|uneven|can’t check here)/, /Frame rate\s+2[34](\.\d+)? fps/, /Control\+Shift\+H also opens and closes this panel/]],
  ['every row carries a judgement word or is a plain fact', 'mse.html?rep=1', [/Colour\s+SDR.*\n(Normal|Note|Unusual)/, /Bitrate\s+[^\n]*\n(Normal|Note|Unusual)/, /Frame rate\s+[^\n]*\n(Normal|Note|Unusual)/]],
];
const crossOrigin = [
  ['DASH list the page itself can\u2019t read stays unread', 'mse.html?rep=1&xo=8795', [/no stream list seen/]],
  ['HLS list the page itself can\u2019t read stays unread', 'hls.html?xo=8795', [/no stream list seen/]],
];

async function runCases(label, page, list, errors) {
  for (const [name, url, pats] of list) {
    const text = (await open(page, url)) || '(no HUD)';
    const missing = pats.filter((p) => !p.test(text));
    check(`${label}: ${name}`, missing.length === 0, 'missing ' + missing.join(', ') + '\n--- HUD ---\n' + text);
  }
  check(`${label}: no page errors`, errors.length === 0, errors.join('\n'));
}


// Sound and "can this browser play the better version" checks. Expectations follow what the engine itself says it can decode.
async function soundCases(label, page, errors) {
  const ask = (t) => page.evaluate((t) => MediaSource.isTypeSupported(t), t);
  const ec3 = await ask('audio/mp4; codecs="ec-3"');
  const hevc = await ask('video/mp4; codecs="hvc1.2.4.L153.B0"');
  const name = label === 'Chromium' ? 'Chrome' : 'Safari';
  console.log(`INFO ${label} says it can play: E-AC-3 ${ec3}, HEVC ${hevc}`);
  let text = (await open(page, 'mse.html?rep=2&audio=1')) || '(no HUD)';
  const dashSound = ec3
    ? [/–\nSound\nAAC stereo · 127\.0\.0\.1’s player chose it over Dolby Digital Plus 5\.1\n/, /Playing\s+AAC stereo, 48 kHz[^\n]*player chose this one\nNote/, /says it can decode it; the player didn’t pick it/]
    : [/AAC stereo · Dolby Digital Plus 5\.1 also sent; (Chrome|Safari) can’t play it/, new RegExp('Playing\\s+AAC stereo, 48 kHz[^\\n]*' + name + ' can’t play Dolby Digital Plus\\nNormal')];
  let pats = dashSound.concat([/Top sent\s+Dolby Digital Plus 5\.1, 48 kHz, 640 kbps/, /After this\s+Movie Sound/]);
  let bad = [/96 kbps/]; // the audio-description track is never "the best"
  bad = bad.concat([/Better sound sent/, /\bPick /, /▲\nSound/]); // the player picks the sound track, so it is never a step
  check(`${label}: DASH sound: playing track, the list's best, and whether ${name} can play it`, pats.every((p) => p.test(text)) && !bad.some((p) => p.test(text)), 'missing ' + pats.filter((p) => !p.test(text)).join(', ') + '\n--- HUD ---\n' + text);

  text = (await open(page, 'hlsplay.html')) || '(no HUD)';
  // The list's 4K is VVC (H.266), which no browser here decodes; its HEVC 1440p decodes where the engine says so.
  // On an HDR screen the spec's missing-HDR line replaces that 1440p sentence; the climb stays in Details.
  const screenHdr = await page.evaluate(() => !!(window.matchMedia && matchMedia('(dynamic-range: high)').matches));
  pats = hevc
    ? (screenHdr ? [/HDR10 sent at this size; (Chrome|Safari) can play it/, /players start low/, /3840×2160, VVC/] : [/sent (Chrome|Safari) up to 1440p/])
    : [/top (Chrome|Safari) can play/, /4K sent needs VVC/];
  pats.push(/4 versions, with HDR10 \(HLS\)/);
  check(`${label}: HLS list whose 4K needs a codec ${name} lacks: judged against what it can play`, pats.every((p) => p.test(text)), 'missing ' + pats.filter((p) => !p.test(text)).join(', ') + '\n--- HUD ---\n' + text);
  text = (await open(page, 'hlsplay.html?m=vvc')) || '(no HUD)';
  pats = [/top (Chrome|Safari) can play/, new RegExp('4K sent needs VVC, which ' + name + ' can’t play'), /Playing\s+1920×1080 \(1080p\), H\.264[^\n]*best [A-Za-z]+ can play/];
  check(`${label}: list whose only bigger version is VVC: "Best ${name} can play"`, pats.every((p) => p.test(text)), 'missing ' + pats.filter((p) => !p.test(text)).join(', ') + '\n--- HUD ---\n' + text);
  check(`${label}: sound and playable-version pages: no page errors`, errors.length === 0, errors.join('\n'));
}

// Serves the plain test page and clip at a real service address, inside the test browser only (no network).
const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
async function serveAs(ctx, origin, clip = 'clip1080.mp4') {
  await ctx.route(origin + '/**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith('.mp4')) return route.fulfill({ path: path.join(FIX, clip) });
    return route.fulfill({ path: path.join(FIX, 'plain.html') });
  });
}
async function serviceCase(label, ctx, page, url, pats, notPats = []) {
  await page.goto(url);
  await page.waitForTimeout(2500);
  await page.keyboard.press('Control+Shift+KeyH');
  await page.waitForTimeout(200);
  await openDetails(page);
  await page.waitForTimeout(1200);
  const text = (await hudText(page)) || '(no HUD)';
  const missing = pats.filter((p) => !p.test(text)).concat(notPats.filter((p) => p.test(text)).map((p) => 'unexpected ' + p));
  check(label, missing.length === 0, 'problems: ' + missing.join(', ') + '\n--- HUD ---\n' + text);
}

const BANNED = /\bthe site\b|\bthis site\b|\bthe list\b|pixel for pixel|bottleneck|\bfix\b|\bno list\b|(?<!stream )\blist goes\b|\bconfirmed list\b|\bin the list\b/i;
async function steadyLayout(label, page) {
  await open(page, 'mse.html?rep=2&blink=1');
  const samples = [];
  for (let i = 0; i < 8; i++) {
    samples.push(await page.evaluate(() => {
      const root = document.querySelector('[data-stream-quality-hud]').shadowRoot;
      const keys = [...root.querySelectorAll('.det .row .k, .quiet b')];
      return { h: root.querySelector('.p').offsetHeight, keys: keys.map((k) => k.textContent + '@' + Math.round(k.getBoundingClientRect().top)).join('|') };
    }));
    await page.waitForTimeout(450);
  }
  // A line may push the others down once, the first time it appears; after that nothing moves, and nothing ever moves up.
  const tops = samples.map((x) => x.keys.split('|').map((k) => +k.split('@')[1]));
  const neverUp = tops.every((t, i) => !i || (t.length === tops[i - 1].length && t.every((y, j) => y >= tops[i - 1][j])));
  const settled = samples.slice(3).every((x) => x.h === samples[3].h && x.keys === samples[3].keys);
  const ok = neverUp && settled;
  check(`${label}: lines that come and go never bounce`, ok, JSON.stringify(samples.map((x) => x.h)) + '\n' + samples.map((x) => x.keys).join('\n'));
}

async function scorecardChecks(label, ctx, page) {
  await serveAs(ctx, 'https://www.netflix.com');
  await serveAs(ctx, 'https://www.paramountplus.com');
  const pillAt = async (url) => {
    await page.goto(url);
    await page.waitForTimeout(2500);
    return page.evaluate(() => {
      const h = document.querySelector('[data-stream-quality-hud]');
      if (!h) return { present: false };
      const b = h.shadowRoot.querySelector('button.pill');
      if (!b) return { present: false };
      const r = b.getBoundingClientRect();
      return { present: true, tag: b.tagName, label: b.getAttribute('aria-label') || '', w: r.width, h: r.height, hidden: !!b.hidden };
    });
  };
  for (const [name, url] of [['Netflix', 'https://www.netflix.com/watch/hudtest'], ['Paramount+', 'https://www.paramountplus.com/movies/video/hudtest/']]) {
    const info = await pillAt(url);
    check(`${label}: pill is on ${name} before any key`, !!(info && info.present && info.tag === 'BUTTON' && info.label.startsWith('Stream quality:') && info.w >= 44 && info.h >= 44 && !info.hidden), JSON.stringify(info));
  }
  await page.goto('https://www.netflix.com/watch/hudtest');
  await page.waitForTimeout(800);
  const toggled = await page.evaluate(() => {
    const h = document.querySelector('[data-stream-quality-hud]');
    const b = h.shadowRoot.querySelector('.pill');
    const p = h.shadowRoot.querySelector('.p');
    b.click();
    const opened = !p.hidden;
    b.click();
    return { opened, closed: p.hidden, stayed: !!h.isConnected && !!h.shadowRoot.querySelector('.pill') };
  });
  check(`${label}: pill click opens, second click closes, pill stays`, toggled.opened && toggled.closed && toggled.stayed, JSON.stringify(toggled));
  await page.evaluate(() => {
    const h = document.querySelector('[data-stream-quality-hud]');
    const b = h.shadowRoot.querySelector('.pill');
    b.click();
    h.shadowRoot.querySelector('summary').click();
    b.focus();
  });
  await page.waitForTimeout(2500);
  const still = await page.evaluate(() => {
    const h = document.querySelector('[data-stream-quality-hud]');
    return { open: h.shadowRoot.querySelector('details').open, focused: h.shadowRoot.activeElement === h.shadowRoot.querySelector('.pill') };
  });
  check(`${label}: Details stays open and the pill keeps focus across renders`, still.open && still.focused, JSON.stringify(still));
  const hit = await page.evaluate(() => {
    const h = document.querySelector('[data-stream-quality-hud]');
    h.shadowRoot.querySelector('details').open = false;
    const head = h.shadowRoot.querySelector('.head');
    const r = head.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { tag: el && el.tagName, host: el === h, inside: !!(el && h.contains(el)), w: r.width, h: r.height };
  });
  check(`${label}: clicks pass through a closed Details panel`, hit.w > 20 && hit.h > 10 && !hit.host && !hit.inside, JSON.stringify(hit));
  await openDetails(page);
  await page.waitForTimeout(200);
  const bannedText = (await hudText(page)) || '';
  check(`${label}: panel text avoids banned phrases`, !BANNED.test(bannedText), bannedText.slice(0, 600));
  if (label === 'Chromium') {
    const mark = await page.evaluate(() => {
      const rows = [...document.querySelector('[data-stream-quality-hud]').shadowRoot.querySelectorAll('.r2')];
      const pic = rows.find((row) => row.querySelector('.k') && row.querySelector('.k').textContent === 'Picture');
      return pic && pic.querySelector('.m') ? pic.querySelector('.m').className : '';
    });
    const ok = /Up to 4K in Safari/.test(bannedText) && /Netflix caps Chrome at 1080p\. Open this film in Safari\./.test(bannedText) && /Computer best: up to 4K Dolby Vision in Safari on a Mac \(Premium; not every film\)/.test(bannedText) && /Not on this Mac: Dolby Atmos \(Windows: Edge or the Netflix app; Premium\)\./.test(bannedText) && mark.split(/\s+/).includes('gap');
    check('Chromium: Netflix picture is a gap, with the Safari 4K line', ok, mark + '\n' + bannedText);
  }
  await page.evaluate(() => {
    const h = document.querySelector('[data-stream-quality-hud]');
    const b = h.shadowRoot.querySelector('.pill');
    h.shadowRoot.querySelector('details').open = false;
    if (!h.shadowRoot.querySelector('.p').hidden) b.click();
    const v = document.querySelector('video');
    v.muted = true;
    const play = v.play();
    if (play && play.catch) play.catch(() => {});
    b.focus();
  });
  await page.waitForTimeout(4000);
  check(`${label}: focused pill does not fade while the video plays`, !(await page.evaluate(() => document.querySelector('[data-stream-quality-hud]').classList.contains('idle'))), 'idle while focused');
  await page.evaluate(() => document.querySelector('[data-stream-quality-hud]').shadowRoot.querySelector('.pill').blur());
  await page.waitForTimeout(4000);
  const faded = await page.evaluate(() => {
    const h = document.querySelector('[data-stream-quality-hud]');
    const pill = h.shadowRoot.querySelector('.pill');
    return { idle: h.classList.contains('idle'), pe: getComputedStyle(pill).pointerEvents, paused: document.querySelector('video').paused };
  });
  check(`${label}: idle pill ignores pointers after 4s with no input`, faded.idle && faded.pe === 'none', JSON.stringify(faded));
  await page.mouse.move(6, 6);
  await page.mouse.move(30, 18);
  await page.waitForTimeout(150);
  check(`${label}: a pointer move clears the fade`, !(await page.evaluate(() => document.querySelector('[data-stream-quality-hud]').classList.contains('idle'))), 'still idle');
  await page.goto(BASE + 'plain.html');
  await page.waitForTimeout(2500);
  const before = await page.evaluate(() => {
    const h = document.querySelector('[data-stream-quality-hud]');
    if (!h) return false;
    const b = h.shadowRoot.querySelector('.pill');
    return !!(b && !b.hidden);
  });
  check(`${label}: short unknown video shows no pill`, !before, 'pill was showing');
  await page.keyboard.press('Control+Shift+KeyH');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => {
    const h = document.querySelector('[data-stream-quality-hud]');
    const p = h && h.shadowRoot.querySelector('.p');
    const b = h && h.shadowRoot.querySelector('.pill');
    return { panel: !!(p && !p.hidden), pill: !!(b && !b.hidden), display: b && getComputedStyle(b).display };
  });
  check(`${label}: the key opens the panel on a short video and still shows no pill`, after.panel && !after.pill && after.display === 'none', JSON.stringify(after));
  await ctx.route(BASE + 'empty.html', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body>No video</body>' }));
  await page.goto(BASE + 'empty.html');
  await page.keyboard.press('Control+Shift+KeyH');
  const empty = await page.evaluate(() => {
    const root = document.querySelector('[data-stream-quality-hud]').shadowRoot;
    const pill = root.querySelector('.pill');
    return { display: getComputedStyle(pill).display, hidden: pill.hidden, panel: !root.querySelector('.p').hidden, title: root.querySelector('.t').textContent };
  });
  check(`${label}: a top page without video opens the panel with the pill display none`, empty.display === 'none' && empty.hidden && empty.panel && empty.title === 'No video yet', JSON.stringify(empty));
}

// Port Sol's callback counters and cold-start checks into isolated test browsers.
async function timingChecks(engine, label) {
  const browser = await engine.launch({ headless: true, args: engine === chromium ? ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] : [] });
  const ctx = await browser.newContext();
  const source = fs.readFileSync(path.join(EXT, 'hud.js'), 'utf8');
  const hooks = `
    window.__hudTiming = {
      report, probe, soundRank,
      state: () => ({ timingOn, raf: rafTimes.length, frame: frameTimes.length, frameVideo: !!frameVideo,
        connected: !!(host && host.isConnected), timer: !!timer, idleTimer: !!idleTimer }),
    };
  `;
  const instrument = `
    window.__count = { raf: 0, rvfc: 0 };
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (fn) => raf(t => { if (fn.name === 'rafLoop') window.__count.raf++; fn(t); });
    const rv = HTMLVideoElement.prototype.requestVideoFrameCallback;
    if (rv) HTMLVideoElement.prototype.requestVideoFrameCallback = function(fn) {
      return rv.call(this, (t, m) => { window.__count.rvfc++; fn(t, m); });
    };
  `;
  await ctx.addInitScript({ content: instrument + source.replace(/\}\)\(\);\s*$/, hooks + '})();') });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + 'plain.html');
  await page.waitForFunction(() => document.querySelector('video').videoWidth > 0);
  await page.waitForTimeout(2300);
  const snapshot = () => page.evaluate(() => ({ ...window.__count, ...window.__hudTiming.state(), callbacks: { ...window.__count } }));
  const before = await snapshot();
  await page.waitForTimeout(1500);
  const short = await snapshot();
  check(`${label}: a short clip without a panel schedules no timing callbacks`, before.callbacks.raf === 0 && before.callbacks.rvfc === 0 && short.callbacks.raf === 0 && short.callbacks.rvfc === 0 && !short.timingOn && !short.connected, JSON.stringify({ before, short }));
  await page.evaluate(() => {
    Object.defineProperty(document.querySelector('video'), 'getVideoPlaybackQuality', { configurable: true, value: undefined });
  });
  await page.keyboard.press('Control+Shift+KeyH');
  await page.waitForTimeout(100);
  const cold = await page.evaluate(() => {
    const r = window.__hudTiming.report();
    return { row: r.sections.find(s => s.name === 'Playback').rows.find(r => r[0] === 'Smoothness'), playback: r.rows.find(r => r.part === 'Playback') };
  });
  check(`${label}: cold timing shows measuring without a judgement and Playback unmeasured`, cold.row[1] === 'measuring…' && cold.row[2] === '' && cold.playback.mark === 'unk' && cold.playback.now === 'Not measured yet', JSON.stringify(cold));
  await page.waitForTimeout(1100);
  const warm = await page.evaluate(() => ({ state: window.__hudTiming.state(), row: window.__hudTiming.report().sections.find(s => s.name === 'Playback').rows.find(r => r[0] === 'Smoothness') }));
  check(`${label}: timing has frame samples about 1.2 seconds after opening`, warm.state.timingOn && warm.state.raf >= 30 && warm.state.frame >= 25 && warm.row[1] !== 'measuring…', JSON.stringify(warm));
  await page.keyboard.press('Control+Shift+KeyH');
  const closed = await snapshot();
  await page.mouse.move(12, 12);
  await page.waitForTimeout(2200);
  const after = await snapshot();
  check(`${label}: closing clears timing and input cannot restart it after the probe`, !after.timingOn && !after.connected && !after.timer && !after.idleTimer && !after.raf && !after.frame && !after.frameVideo && after.callbacks.raf === closed.callbacks.raf && after.callbacks.rvfc === closed.callbacks.rvfc, JSON.stringify({ closed, after }));
  await page.evaluate(() => document.querySelector('video').remove());
  await page.waitForTimeout(1200);
  const removed = await snapshot();
  check(`${label}: removing the short clip leaves zero timing callbacks`, removed.callbacks.raf === after.callbacks.raf && removed.callbacks.rvfc === after.callbacks.rvfc && !removed.timingOn, JSON.stringify(removed));
  await page.goto(BASE + 'plain.html');
  await page.waitForFunction(() => document.querySelector('video').videoWidth > 0);
  await page.evaluate(() => {
    Object.defineProperty(document.querySelector('video'), 'duration', { configurable: true, value: 7200 });
    window.__hudTiming.probe();
  });
  await page.waitForTimeout(1200);
  const pill = await snapshot();
  await page.evaluate(() => document.querySelector('video').remove());
  await page.waitForTimeout(1200);
  const left = await snapshot();
  await page.waitForTimeout(1200);
  const stopped = await snapshot();
  check(`${label}: timing runs with the pill and stops when its video leaves`, pill.connected && pill.timingOn && pill.frame >= 25 && !left.connected && !left.timingOn && !left.raf && !left.frame && stopped.callbacks.raf === left.callbacks.raf && stopped.callbacks.rvfc === left.callbacks.rvfc, JSON.stringify({ pill, left, stopped }));
  const ranks = await page.evaluate(() => [
    'mono', { ch: { n: 1 } }, 'stereo', 'spatial stereo', { ch: { n: 2 } },
    '5.1', '7.1', 'DTS', { ch: { n: 6 } }, 'Dolby Atmos', { joc: true }, '', { ch: { n: 0 } },
  ].map(window.__hudTiming.soundRank));
  check(`${label}: mono, stereo, surround, Atmos and unknown stay distinct`, JSON.stringify(ranks) === JSON.stringify([1, 1, 2, 2, 2, 6, 6, 6, 6, 8, 8, 0, 0]), JSON.stringify(ranks));
  check(`${label}: timing lifecycle has no page errors`, errors.length === 0, errors.join('\n'));
  await browser.close();
}

// ---- Chromium with the real extension ----
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqhud-chromium-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: 'chromium',
    headless: true,
    args: ['--disable-extensions-except=' + EXT, '--load-extension=' + EXT, '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--host-resolver-rules=MAP cdn.test 127.0.0.1'],
  });
  let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 10000 }));
  const page = ctx.pages()[0] || (await ctx.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await runCases('Chromium', page, [...cases, ...crossOrigin], errors);
  await steadyLayout('Chromium', page);
  await soundCases('Chromium', page, errors);
  {
    const sdr = !(await page.evaluate(() => matchMedia('(dynamic-range: high)').matches));
    const text = (await open(page, 'hlsplay.html?m=hdr')) || '(no HUD)';
    if (!sdr) console.log('SKIP Chromium: this headless screen reports HDR');
    else check('Chromium (SDR screen): a playable HDR10 version is explained, not blamed on codecs', /Colour\s+SDR[^\n]*HDR10 listed; screen is SDR only/.test(text) && !/need a codec/.test(text), '--- HUD ---\n' + text);
  }
  {
    const text = (await open(page, 'hlsaudio.html')) || '(no HUD)';
    const pats = [/AAC stereo · Dolby Atmos also sent; Chrome can’t play it/, /Top sent\s+Dolby Atmos/, /2 versions, all SDR \(HLS\)/, /After this\s+Movie Sound, Chrome audio extension[^\n]*both on = processed twice/];
    check('Chromium: HLS audio groups: stereo playing, Atmos listed, versions counted once', pats.every((p) => p.test(text)), 'missing ' + pats.filter((p) => !p.test(text)).join(', ') + '\n--- HUD ---\n' + text);
  }

  // second press hides it
  await page.keyboard.press('Control+Shift+KeyH');
  await page.waitForTimeout(300);
  check('Chromium: second Control+Shift+H hides the panel', (await hudText(page)) === null, 'still shown');

  // toolbar button path: the same message the background sends on a click
  sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 10000 }));
  const sent = await sw.evaluate(async () => {
    const tab = (await chrome.tabs.query({}))[0]; // the only tab (no site access, so no tab URLs)
    if (!tab) return 'no test tab';
    toggleTab(tab.id); // what a toolbar click runs
    return 'sent';
  });
  if (sent !== 'sent') console.log('INFO toolbar message: ' + sent);
  await page.waitForTimeout(1500);
  check('Chromium: toolbar message shows the panel', /Details/.test((await hudText(page)) || ''), 'not shown');


  // no privileged fetching: the extension asks for no site access beyond its content script
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  check('Manifest: no host_permissions or permissions', !manifest.host_permissions && !manifest.permissions, JSON.stringify({ host: manifest.host_permissions, perms: manifest.permissions }));

  // video inside an iframe: toolbar and key both show one panel, in the frame with the video
  await page.goto(BASE + 'frame.html');
  await page.waitForFunction(() => document.querySelector('iframe').contentDocument && document.querySelector('iframe').contentDocument.querySelector('video') && document.querySelector('iframe').contentDocument.querySelector('video').videoHeight > 0);
  sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 10000 }));
  await sw.evaluate(async () => toggleTab((await chrome.tabs.query({}))[0].id));
  await page.waitForTimeout(1500);
  const frameTop = await hudText(page), frameChild = await hudText(page.frames()[1]);
  check('Chromium: toolbar shows one panel, inside the video iframe', frameTop === null && /no stream list seen/.test(frameChild || ''), JSON.stringify({ frameTop, frameChild }));
  await page.evaluate(() => { document.body.tabIndex = -1; document.body.focus(); });
  await page.keyboard.press('Control+Shift+KeyH');
  await page.waitForTimeout(800);
  check('Chromium: key pressed in the top page hides the iframe panel', (await hudText(page.frames()[1])) === null && (await hudText(page)) === null, 'still shown');

  // full screen: the panel must move inside the full-screen element
  await page.goto(BASE + 'plain.html');
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.id = 'wrap';
    document.body.prepend(d);
    d.appendChild(document.getElementById('v'));
  });
  await page.keyboard.press('Control+Shift+KeyH');
  const fsOk = await page.evaluate(async () => {
    try {
      await document.getElementById('wrap').requestFullscreen();
    } catch (e) {
      return 'no fullscreen in this browser: ' + e;
    }
    await new Promise((r) => setTimeout(r, 1500));
    const host = document.querySelector('#wrap > [data-stream-quality-hud]');
    if (!host) return 'outside';
    const root = host.shadowRoot;
    return root.querySelector('.pill') && root.querySelector('.p') ? 'inside' : 'missing pill or panel';
  });
  if (fsOk.startsWith('no fullscreen')) console.log('SKIP Chromium: full screen (' + fsOk + ')');
  else check('Chromium: panel moves into the full-screen element', fsOk === 'inside', fsOk);

  // what each service offers anywhere vs this browser
  for (const o of ['https://www.netflix.com', 'https://www.amcplus.com', 'https://www.amazon.com']) await serveAs(ctx, o);
  await serveAs(ctx, 'https://www.primevideo.com', 'clip720.mp4');
  await serviceCase('Chromium: Netflix at Chrome’s 1080p cap says where more is', ctx, page, 'https://www.netflix.com/watch/hudtest', [/Up to 4K in Safari/, /Netflix caps Chrome at 1080p\. Open this film in Safari\./, /Computer best: up to 4K Dolby Vision in Safari on a Mac \(Premium; not every film\)/, /Not on this Mac: Dolby Atmos \(Windows: Edge or the Netflix app; Premium\)\./, /Mac best: spatial stereo \(Premium; eligible titles\)/, /Netflix\s+up to 1080p in Chrome/, /best anywhere: 4K HDR \(Dolby Vision\)/]);
  await serviceCase('Chromium: AMC+ limits are unknown, so no verdict and no “elsewhere” line', ctx, page, 'https://www.amcplus.com/movies/hudtest', [/AMC\+\s+limit for Chrome: unknown/, /best anywhere: unknown/, /Computer best: unknown for AMC\+\./, /no stream list seen/], [/Elsewhere:/, /AMC\+ sends/, /Computer best: unknown(?! for)/]);
  await serviceCase('Chromium: Prime Video (amazon.com/gp/video) 1080p is within its “HD”', ctx, page, 'https://www.amazon.com/gp/video/detail/hudtest', [/within “HD”, Prime Video’s most for Chrome/, /Computer best: HD, in browsers and the Mac and Windows apps/, /Prime Video\s+up to HD in Chrome/, /Published for TV apps: 4K Dolby Vision, Dolby Atmos \(US 4K needs Prime Video Ultra\)\./, /Computer best: stereo, in browsers and the Mac and Windows apps/, /best anywhere: Dolby Atmos/]);
  const prime1080Mark = await page.evaluate(() => [...document.querySelector('[data-stream-quality-hud]').shadowRoot.querySelectorAll('.r2')].find(r => r.querySelector('.k').textContent === 'Picture').querySelector('.m').className);
  check('Chromium: Prime Video 1080p still earns a computer-best checkmark', prime1080Mark === 'm ok', prime1080Mark);
  await serviceCase('Chromium: Prime Video (primevideo.com) 720p is within “HD” but its top size is unconfirmed', ctx, page, 'https://www.primevideo.com/detail/hudtest', [/within Prime Video’s “HD”; its top size isn’t published/, /Playing\s+1280×720 \(720p\)[^\n]*“HD” is Prime Video’s word; no number/], [/Picture not at top yet/, /Picture below/, /720p: Prime Video’s most/]);
  const primeMark = await page.evaluate(() => [...document.querySelector('[data-stream-quality-hud]').shadowRoot.querySelectorAll('.r2')].find(r => r.querySelector('.k').textContent === 'Picture').querySelector('.m').className);
  check('Chromium: Prime Video 720p cannot earn a computer-best checkmark', primeMark === 'm unk', primeMark);
  await serviceCase('Chromium: ordinary amazon.com pages get no service rows', ctx, page, 'https://www.amazon.com/some-product/dp/hudtest', [/Playing/], [/Prime Video/]);
  await scorecardChecks('Chromium', ctx, page);
  await ctx.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---- WebKit (hud.js as an init script; same-origin lists only) ----
{
  const browser = await webkit.launch({ headless: true });
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    window.chrome = { runtime: { lastError: null, sendMessage: (m, cb) => cb({ ok: false, error: 'stub' }), onMessage: { addListener() {} } } };
  });
  await ctx.addInitScript({ path: path.join(EXT, 'hud.js') });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await steadyLayout('WebKit', page);
  await runCases('WebKit', page, [...cases, ['native HLS: the list is the video\u2019s own source', 'hlsnative.html', [/matched to its source/, /only version sent to Safari|top of \d+ sent to Safari|sent Safari up to|top Safari can play/, /Source\s+HLS \(WebKit’s own player\)/]]], errors);
  await soundCases('WebKit', page, errors);
  {
    const ctxB = await browser.newContext();
    await ctxB.addInitScript({ path: path.join(EXT, 'hud.js') });
    let mpd = fs.readFileSync(path.join(FIX, 'dash/stream.mpd'), 'utf8');
    mpd = mpd.replace(/<AdaptationSet id="2"[\s\S]*?<\/AdaptationSet>\s*/, '').replace(/(<Representation id="3"[\s\S]*?<\/Representation>)/, (r) => r + '\n' + r.replace('id="3"', 'id="6"').replace('bandwidth="128000"', 'bandwidth="256000"'));
    await ctxB.route('**/dash/stream.mpd', (route) => route.fulfill({ contentType: 'application/dash+xml', body: mpd }));
    const pageB = await ctxB.newPage();
    const text = (await open(pageB, 'mse.html?rep=2&audio=1')) || '(no HUD)';
    check('WebKit: an unknown playing bitrate is never called worse than the same codec at a known one', /only version sent to Safari|top of \d+ sent to Safari/.test(text) && !/\bPick /.test(text) && !/Better sound sent/.test(text) && /id="6"/.test(mpd), '--- HUD ---\n' + text);
    await ctxB.close();
  }
  {
    const pats = [/720p(?: SDR)? · only version sent to Safari/, /AAC stereo · (only|top) track sent to Safari/, /Playing\s+AAC stereo, 48 kHz/, /After this\s+Movie Sound, if on/];
    // WebKit fills in the track's details a moment after native HLS starts; give it up to 6 more seconds.
    let text = (await open(page, 'hlsnativeaudio.html')) || '(no HUD)';
    for (let i = 0; i < 6 && !pats.every((p) => p.test(text)); i++) (await page.waitForTimeout(1000)), (text = (await hudText(page)) || '(no HUD)');
    check('WebKit: native HLS with a sound track: track details from WebKit', pats.every((p) => p.test(text)), 'missing ' + pats.filter((p) => !p.test(text)).join(', ') + '\n--- HUD ---\n' + text);
  }
  {
    // An HDR screen (stood in for: hud.js runs in the page's own world here): a playable HDR10 version of the playing size, while SDR plays.
    const ctxH = await browser.newContext();
    await ctxH.addInitScript(() => {
      const mm = window.matchMedia.bind(window);
      window.matchMedia = (q) => (/dynamic-range:\s*high/.test(q) ? { matches: true, media: q } : mm(q));
    });
    await ctxH.addInitScript({ path: path.join(EXT, 'hud.js') });
    const pageH = await ctxH.newPage();
    const text = (await open(pageH, 'hlsplay.html?m=hdr')) || '(no HUD)';
    const pats = [/HDR sent, SDR playing/, /sent HDR10 at this size, and Safari can play it/, /Colour\s+SDR[^\n]*\nUnusual/];
    check('WebKit (HDR screen): SDR playing while a playable HDR10 version exists', pats.every((p) => p.test(text)), 'missing ' + pats.filter((p) => !p.test(text)).join(', ') + '\n--- HUD ---\n' + text);
    await ctxH.close();
  }
  await page.goto(BASE + 'mse.html?rep=1');
  await page.waitForFunction(() => document.title === 'playing', null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const probe = await page.evaluate(() => {
    const v = document.getElementById('v');
    const t = v.videoTracks && v.videoTracks[0];
    const c = t && t.configuration;
    const cfg = {};
    if (c) for (const k in c) cfg[k] = typeof c[k] === 'object' && c[k] ? JSON.stringify(c[k]) : c[k];
    return { decodedBytes: v.webkitVideoDecodedByteCount, tracks: v.videoTracks ? v.videoTracks.length : null, cfg };
  });
  console.log('INFO WebKit MSE video track:', JSON.stringify(probe));

  // Safari/Orion: Netflix's cap equals its best, so no cap hint
  const ctx2 = await browser.newContext();
  await ctx2.addInitScript({ path: path.join(EXT, 'hud.js') }); // userscript conditions: no extension API at all
  await serveAs(ctx2, 'https://www.netflix.com');
  const page2 = await ctx2.newPage();
  const errors2 = [];
  page2.on('pageerror', (e) => errors2.push(String(e)));
  await serviceCase('WebKit (userscript, no extension API): Netflix 1080p in Safari is below its 4K, hedged', ctx2, page2, 'https://www.netflix.com/watch/hudtest', [/4K possible in Safari/, /Playing 1080p; Netflix offers Safari up to 4K if the film and plan allow\./, /Netflix\s+up to 4K in Safari \(Orion isn’t covered\)/], [/Elsewhere:/]);
  {
    // Paramount+'s browser limit is unknown; its 4K is a TV-app best, so it must not read as on offer in Safari.
    const ctxP = await browser.newContext();
    await ctxP.addInitScript({ path: path.join(EXT, 'hud.js') });
    await serveAs(ctxP, 'https://www.paramountplus.com');
    const pageP = await ctxP.newPage();
    const pText = await (async () => {
      await pageP.goto('https://www.paramountplus.com/movies/video/hudtest/');
      await pageP.waitForTimeout(2500);
      await pageP.keyboard.press('Control+Shift+KeyH');
      await pageP.waitForTimeout(200);
      await openDetails(pageP);
      await pageP.waitForTimeout(1200);
      return (await hudText(pageP)) || '(no HUD)';
    })();
    const measuredHz = Number((pText.match(/Refresh\s+(\d+) Hz/) || [])[1]);
    const limited = measuredHz > 0 && measuredHz <= 61;
    const pPats = [/Computer best: unknown for Paramount\+\./, /Published for TV apps: 4K Dolby Vision, Dolby Atmos \(Premium\); unconfirmed for computers\./, /Paramount\+\s+limit for Safari\/Orion: unknown/];
    if (limited) pPats.push(new RegExp('Safari page at ' + measuredHz + ' Hz'), /Safari › Settings › Advanced › tick “Show features for web developers”/, /Develop › Feature Flags… › untick “Prefer Page Rendering Updates near 60fps”, then reload this page/);
    const pBad = [/Computer best: unknown(?! for)/, ...(!limited ? [/Safari page at \d+ Hz/] : [])];
    const pMissing = pPats.filter((p) => !p.test(pText)).concat(pBad.filter((p) => p.test(pText)).map((p) => 'unexpected ' + p));
    check('WebKit (userscript): Paramount+ computer best is unknown; 60 Hz lead follows the measured rate', measuredHz > 0 && pMissing.length === 0, 'measuredHz=' + measuredHz + ' problems: ' + pMissing.join(', ') + '\n--- HUD ---\n' + pText);
    await ctxP.close();
  }
  {
    // Orion with Chrome's user agent: named Orion, and no service's Chrome limit is applied to it.
    const ctxO = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36' });
    await ctxO.addInitScript({ path: path.join(EXT, 'hud.js') });
    await serveAs(ctxO, 'https://www.netflix.com');
    const pageO = await ctxO.newPage();
    await serviceCase('WebKit with Chrome’s user agent (Orion): named Orion, no Chrome limit', ctxO, pageO, 'https://www.netflix.com/watch/hudtest', [/Up to 4K in Safari/, /Netflix\s+limit for Orion: unknown/, /Netflix offers up to 4K Dolby Vision in Safari on a Mac/], [/Chrome/]);
    await ctxO.close();
  }
  await page2.keyboard.press('Control+Shift+KeyH');
  await page2.waitForTimeout(300);
  check('WebKit (userscript): Control+Shift+H hides it again', (await hudText(page2)) === null, 'still shown');
  check('WebKit (userscript): no page errors', errors2.length === 0, errors2.join('\n'));
  await ctx2.close();
  await scorecardChecks('WebKit', ctx, page);
  await browser.close();
}

await timingChecks(chromium, 'Chromium');
await timingChecks(webkit, 'WebKit');

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
