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
    return h && h.isConnected ? h.shadowRoot.querySelector('.p').innerText : null;
  });

async function open(page, url) {
  await page.goto(BASE + url);
  if (url.startsWith('mse')) await page.waitForFunction(() => document.title === 'playing' || document.title.startsWith('error'), null, { timeout: 15000 });
  await page.waitForTimeout(2500);
  await page.keyboard.press('Control+Shift+KeyH');
  await page.waitForTimeout(2500);
  return hudText(page);
}

const B = '(Chrome|Safari)';
const cases = [
  ['DASH, 720p playing', 'mse.html?rep=1', [/Not the best picture yet/, new RegExp('Playing 720p; this site offers ' + B + ' 1080p\\.'), /matched to the video’s own downloads/, /Playing\s+1280×720 \(720p\), H\.264/, /Site’s best\s+1920×1080, H\.264, 6\.0 Mbps/, /3 versions to 1080p, all SDR \(DASH\)/, /Bitrate\s+3\.0 Mbps \(site’s list\)/]],
  ['DASH, 1080p playing', 'mse.html?rep=2', [/Best this site offers/, new RegExp('1080p is the top of the 3 versions the site sent ' + B + '\\. The site doesn’t say whether its apps get more\\.'), /Source\s+adaptive stream \(Media Source\)/]],
  ['DASH film plus a trailer list: downloads pick the film', 'mse.html?rep=1&trailer=1', [/Not the best picture yet/, /matched to the video’s own downloads/, /\(DASH\)/]],
  ['HLS list seen but not this video’s: no verdict', 'hls.html', [/Can’t confirm the picture/, /None of this page’s quality lists is confirmed as this video’s/, /Lists seen\s+1 \(best in them: 4K\)/]],
  ['plain file, no list', 'plain.html', [/Can’t confirm the picture/, /No quality list seen/, /Playing\s+1920×1080 \(1080p\)/, /On screen\s+\d+×\d+ px/, /Dropped\s+\d+ of/, /Refresh\s+\d+ Hz/, /Smoothness\s+(even|uneven|can’t check here)/, /Frame rate\s+2[34](\.\d+)? fps/, /Control\+Shift\+H hides/]],
  ['every row carries a judgement word or is a plain fact', 'mse.html?rep=1', [/Colour\s+SDR.*\n(Normal|Note|Unusual)/, /Bitrate\s+[^\n]*\n(Normal|Note|Unusual)/, /Frame rate\s+[^\n]*\n(Normal|Note|Unusual)/]],
];
const crossOrigin = [
  ['DASH list the page itself can\u2019t read stays unread', 'mse.html?rep=1&xo=8795', [/No quality list seen/]],
  ['HLS list the page itself can\u2019t read stays unread', 'hls.html?xo=8795', [/No quality list seen/]],
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
    ? [/Best picture, not the best sound/, new RegExp('Sound: AAC stereo is playing; the site also has Dolby Digital Plus 5\\.1, which ' + name + ' can play'), /Pick the Dolby Digital Plus 5\.1 track/, /Playing\s+AAC stereo, 48 kHz[^\n]*\nUnusual/]
    : [/Best this site offers/, new RegExp('Sound: AAC stereo; the site’s Dolby Digital Plus 5\\.1 doesn’t play in ' + name + '\\.'), new RegExp('Playing\\s+AAC stereo, 48 kHz[^\\n]*' + name + ' can’t play Dolby Digital Plus\\nNormal')];
  let pats = dashSound.concat([/Site’s best\s+Dolby Digital Plus 5\.1, 48 kHz, 640 kbps/, /After this\s+Movie Sound/]);
  let bad = [/96 kbps/]; // the audio-description track is never "the best"
  check(`${label}: DASH sound: playing track, the list's best, and whether ${name} can play it`, pats.every((p) => p.test(text)) && !bad.some((p) => p.test(text)), 'missing ' + pats.filter((p) => !p.test(text)).join(', ') + '\n--- HUD ---\n' + text);

  text = (await open(page, 'hlsplay.html')) || '(no HUD)';
  // The list's 4K is VVC (H.266), which no browser here decodes; its HEVC 1440p decodes where the engine says so.
  pats = hevc
    ? [/Not the best picture yet/, new RegExp('Playing 1080p; this site offers ' + name + ' 1440p\\.')]
    : [new RegExp('Best ' + name + ' can play here'), /The 4K version is VVC/];
  pats.push(/4 versions to 4K, with HDR10 \(HLS\)/);
  check(`${label}: HLS list whose 4K needs a codec ${name} lacks: judged against what it can play`, pats.every((p) => p.test(text)), 'missing ' + pats.filter((p) => !p.test(text)).join(', ') + '\n--- HUD ---\n' + text);
  text = (await open(page, 'hlsplay.html?m=vvc')) || '(no HUD)';
  pats = [new RegExp('Best ' + name + ' can play here'), new RegExp('The 4K version is VVC, which ' + name + ' says it can’t play\\.'), /Playing\s+1920×1080 \(1080p\), H\.264[^\n]*the best [A-Za-z]+ can play from the list/];
  check(`${label}: list whose only bigger version is VVC: "Best ${name} can play here"`, pats.every((p) => p.test(text)), 'missing ' + pats.filter((p) => !p.test(text)).join(', ') + '\n--- HUD ---\n' + text);
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
  await page.waitForTimeout(1500);
  const text = (await hudText(page)) || '(no HUD)';
  const missing = pats.filter((p) => !p.test(text)).concat(notPats.filter((p) => p.test(text)).map((p) => 'unexpected ' + p));
  check(label, missing.length === 0, 'problems: ' + missing.join(', ') + '\n--- HUD ---\n' + text);
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
  await soundCases('Chromium', page, errors);
  {
    const sdr = !(await page.evaluate(() => matchMedia('(dynamic-range: high)').matches));
    const text = (await open(page, 'hlsplay.html?m=hdr')) || '(no HUD)';
    if (!sdr) console.log('SKIP Chromium: this headless screen reports HDR');
    else check('Chromium (SDR screen): a playable HDR10 version is explained, not blamed on codecs', /Colour\s+SDR[^\n]*an HDR10 version of this size, but this screen is SDR only/.test(text) && !/need a codec/.test(text), '--- HUD ---\n' + text);
  }
  {
    const text = (await open(page, 'hlsaudio.html')) || '(no HUD)';
    const pats = [/Sound: AAC stereo; the site’s Dolby Atmos doesn’t play in Chrome\./, /Site’s best\s+Dolby Atmos/, /2 versions to 1080p, all SDR \(HLS\)/, /After this\s+Movie Sound, Chrome audio extension[^\n]*with both on, the sound is processed twice/];
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
  check('Chromium: toolbar message shows the panel', /Control\+Shift\+H hides/.test((await hudText(page)) || ''), 'not shown');


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
  check('Chromium: toolbar shows one panel, inside the video iframe', frameTop === null && /Playing\s+1920×1080/.test(frameChild || ''), JSON.stringify({ frameTop, frameChild }));
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
    return document.querySelector('#wrap > [data-stream-quality-hud]') ? 'inside' : 'outside';
  });
  if (fsOk.startsWith('no fullscreen')) console.log('SKIP Chromium: full screen (' + fsOk + ')');
  else check('Chromium: panel moves into the full-screen element', fsOk === 'inside', fsOk);

  // what each service offers anywhere vs this browser
  for (const o of ['https://www.netflix.com', 'https://www.amcplus.com', 'https://www.amazon.com']) await serveAs(ctx, o);
  await serveAs(ctx, 'https://www.primevideo.com', 'clip720.mp4');
  await serviceCase('Chromium: Netflix at Chrome’s 1080p cap says Safari gets more, and where', ctx, page, 'https://www.netflix.com/watch/hudtest', [/Best Chrome gets here; Safari gets more/, /1080p is the most Netflix sends Chrome\./, /Better: 4K HDR \(Dolby Vision\)\. Where: Safari on a Mac/, /Netflix\s+up to 1080p in Chrome/, /best anywhere: 4K HDR \(Dolby Vision\)/, /Sound: Netflix sends Chrome spatial stereo \(Premium, eligible titles\); best anywhere: Dolby Atmos \(Premium; Apple TV 4K app\)\./]);
  await serviceCase('Chromium: AMC+ publishes nothing, so no verdict and no “better” line', ctx, page, 'https://www.amcplus.com/movies/hudtest', [/Can’t confirm the picture/, /AMC\+\s+no published limit for Chrome/, /doesn’t publish its best/], [/Better:/, /AMC\+ sends/]);
  await serviceCase('Chromium: Prime Video (amazon.com/gp/video) 1080p is within its “HD”', ctx, page, 'https://www.amazon.com/gp/video/detail/hudtest', [/Best Chrome gets here; TV apps get more/, /1080p is within “HD”, all Prime Video says it sends Chrome\./, /Prime Video\s+up to HD in Chrome/, /Sound: Prime Video sends Chrome stereo; best anywhere: Dolby Atmos \(US Ultra/, /Prime Video\s+stereo in Chrome[^\n]*best anywhere: Dolby Atmos/]);
  await serviceCase('Chromium: Prime Video (primevideo.com) 720p counts as within “HD”', ctx, page, 'https://www.primevideo.com/detail/hudtest', [/Best Chrome gets here; TV apps get more/, /720p is within “HD”, all Prime Video says it sends Chrome\./, /Playing\s+1280×720 \(720p\)[^\n]*within “HD”, Prime Video’s word; it gives no number/], [/Not the best/, /is the most Prime Video/]);
  await serviceCase('Chromium: ordinary amazon.com pages get no service rows', ctx, page, 'https://www.amazon.com/some-product/dp/hudtest', [/Playing/], [/Prime Video/]);
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
  await runCases('WebKit', page, [...cases, ['native HLS: the list is the video\u2019s own source', 'hlsnative.html', [/matched to the video’s own source/, /(Best this site offers|Not the best picture yet)/, /Source\s+HLS \(played by WebKit itself\)/]]], errors);
  await soundCases('WebKit', page, errors);
  {
    const ctxB = await browser.newContext();
    await ctxB.addInitScript({ path: path.join(EXT, 'hud.js') });
    let mpd = fs.readFileSync(path.join(FIX, 'dash/stream.mpd'), 'utf8');
    mpd = mpd.replace(/<AdaptationSet id="2"[\s\S]*?<\/AdaptationSet>\s*/, '').replace(/(<Representation id="3"[\s\S]*?<\/Representation>)/, (r) => r + '\n' + r.replace('id="3"', 'id="6"').replace('bandwidth="128000"', 'bandwidth="256000"'));
    await ctxB.route('**/dash/stream.mpd', (route) => route.fulfill({ contentType: 'application/dash+xml', body: mpd }));
    const pageB = await ctxB.newPage();
    const text = (await open(pageB, 'mse.html?rep=2&audio=1')) || '(no HUD)';
    check('WebKit: an unknown playing bitrate is never called worse than the same codec at a known one', /Best this site offers/.test(text) && !/Pick the/.test(text) && /id="6"/.test(mpd), '--- HUD ---\n' + text);
    await ctxB.close();
  }
  {
    const pats = [/Best this site offers/, /720p is the only version the site sent Safari/, /Sound: AAC stereo, the best on the site’s list\./, /Playing\s+AAC stereo, 48 kHz/, /After this\s+Movie Sound, if on/];
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
    const pats = [/Best size, not HDR/, /An HDR10 version of 1080p is on the list and Safari can play it; SDR is playing\./, /Colour\s+SDR[^\n]*\nUnusual/];
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
  await serviceCase('WebKit (userscript, no extension API): Netflix 1080p in Safari is below its 4K, hedged', ctx2, page2, 'https://www.netflix.com/watch/hudtest', [/Not the best picture yet/, /Playing 1080p; Netflix sends Safari up to 4K when the title and plan have it\./, /Netflix\s+up to 4K in Safari \(Orion isn’t covered\)/], [/Better:/]);
  {
    // Orion with Chrome's user agent: named Orion, and no service's Chrome limit is applied to it.
    const ctxO = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36' });
    await ctxO.addInitScript({ path: path.join(EXT, 'hud.js') });
    await serveAs(ctxO, 'https://www.netflix.com');
    const pageO = await ctxO.newPage();
    await serviceCase('WebKit with Chrome’s user agent (Orion): named Orion, no Chrome limit', ctxO, pageO, 'https://www.netflix.com/watch/hudtest', [/Can’t confirm the picture/, /Netflix\s+no published limit for Orion/, /Better: 4K HDR/], [/Chrome/]);
    await ctxO.close();
  }
  await page2.keyboard.press('Control+Shift+KeyH');
  await page2.waitForTimeout(300);
  check('WebKit (userscript): Control+Shift+H hides it again', (await hudText(page2)) === null, 'still shown');
  check('WebKit (userscript): no page errors', errors2.length === 0, errors2.join('\n'));
  await ctx2.close();
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
