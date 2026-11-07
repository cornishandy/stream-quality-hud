// Measurement checks for Stream Quality HUD 1.13.0. Ground truth goes through the unpacked
// extension's page-world reader. Accounting runs in a same-world copy of hud.js, because the
// isolated extension world is not reachable from page.evaluate.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function p95(xs) {
  if (!xs || !xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const i = 0.95 * (s.length - 1);
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] * (hi - i) + s[hi] * (i - lo);
}

function summarize(records) {
  const bins = {};
  let frames = 0, keys = 0, bytes = 0, min = Infinity, max = 0;
  const whys = [];
  let tracks = null, vide = 0;
  for (const rec of records || []) {
    if (rec.t === 'st' && rec.why) whys.push(rec.why);
    if (rec.t === 'init') {
      vide = rec.vide || 0;
      if (rec.tracks) tracks = rec.tracks;
    }
    if (rec.t !== 'f' || !rec.samples) continue;
    const ts = rec.timescale || 1;
    for (const s of rec.samples) {
      const pts = s[0] / ts + (rec.offset || 0);
      const end = pts + s[1] / ts;
      const sec = Math.floor(pts + 1e-6);
      bins[sec] = (bins[sec] || 0) + s[2];
      frames++;
      bytes += s[2];
      if (s[3] === 1) keys++;
      if (pts < min) min = pts;
      if (end > max) max = end;
    }
  }
  const dur = max > min ? max - min : 0;
  return { bins, frames, keys, bytes, min: min === Infinity ? 0 : min, max, dur, whys, tracks, vide, avg: dur ? (bytes * 8) / dur : 0 };
}

function dedupe(records) {
  const seen = new Map();
  for (const rec of records || []) {
    if (typeof rec.seq === 'number') seen.set((rec.session || '') + ':' + rec.seq, rec);
    else seen.set('x' + seen.size, rec);
  }
  return [...seen.values()];
}

function binsMatch(got, truth) {
  const keys = Object.keys(truth.bins);
  if (keys.length !== Object.keys(got.bins).length) return false;
  return keys.every((k) => got.bins[k] === truth.bins[k]);
}

function boxEnd(buf, at) {
  const size = buf.readUInt32BE(at);
  if (size === 1) return at + Number(buf.readBigUInt64BE(at + 8));
  if (size === 0) return buf.length;
  return at + size;
}
function findBox(buf, type, from = 0, to = buf.length) {
  let p = from;
  while (p + 8 <= to) {
    const size = buf.readUInt32BE(p);
    const end = size === 1 ? p + Number(buf.readBigUInt64BE(p + 8)) : size === 0 ? to : p + size;
    if (end <= p || end > to) break;
    if (buf.toString('ascii', p + 4, p + 8) === type) return { at: p, end };
    p = end;
  }
  return null;
}
function sampleEntryOffset(init) {
  const moov = findBox(init, 'moov');
  const trak = findBox(init, 'trak', moov.at + 8, moov.end);
  const mdia = findBox(init, 'mdia', trak.at + 8, trak.end);
  const minf = findBox(init, 'minf', mdia.at + 8, mdia.end);
  const stbl = findBox(init, 'stbl', minf.at + 8, minf.end);
  const stsd = findBox(init, 'stsd', stbl.at + 8, stbl.end);
  return stsd.at + 16;
}
function splitEmptyMdat(chunk) {
  const b = Buffer.from(chunk);
  const moof = findBox(b, 'moof');
  const mdat = findBox(b, 'mdat');
  let p = moof.at + 8;
  while (p + 8 <= moof.end) {
    const end = boxEnd(b, p);
    if (b.toString('ascii', p + 4, p + 8) === 'traf') {
      let q = p + 8;
      while (q + 8 <= end) {
        const tend = boxEnd(b, q);
        if (b.toString('ascii', q + 4, q + 8) === 'trun' && (b.readUInt32BE(q + 8) & 1)) b.writeInt32BE(b.readInt32BE(q + 16) + 8, q + 16);
        q = tend;
      }
    }
    p = end;
  }
  const empty = Buffer.alloc(8);
  empty.writeUInt32BE(8);
  empty.write('mdat', 4);
  return { prefix: Buffer.concat([b.subarray(0, mdat.at), empty, b.subarray(mdat.at, mdat.at + 8)]), rest: b.subarray(mdat.at + 8) };
}
function fourccBox(type, body) {
  const out = Buffer.alloc(8 + body.length);
  out.writeUInt32BE(out.length);
  out.write(type, 4);
  body.copy(out, 8);
  return out;
}
function twoTrunMoof(trackId) {
  const tfhd = Buffer.alloc(24);
  tfhd.writeUInt32BE(0x020038);
  tfhd.writeUInt32BE(trackId, 4);
  tfhd.writeUInt32BE(512, 8);
  tfhd.writeUInt32BE(1, 12);
  tfhd.writeUInt32BE(0x01000000, 16);
  const trun = (count) => { const t = Buffer.alloc(8); t.writeUInt32BE(0); t.writeUInt32BE(count, 4); return fourccBox('trun', t); };
  const traf = fourccBox('traf', Buffer.concat([fourccBox('tfhd', tfhd), trun(16000), trun(16000)]));
  return fourccBox('moof', traf);
}
function loadApi(now) {
  const code = fs.readFileSync(new URL('../extension/page-hook.js', import.meta.url), 'utf8');
  const g = {
    SQH_READER_TEST: true,
    performance: { now: now || (() => 0) },
    Uint8Array, ArrayBuffer, DataView, Symbol, Map, Math, JSON, String, Number,
  };
  vm.runInNewContext(code, g, { filename: 'page-hook.js' });
  return g.SQH_READER_API;
}

const APPEND_JS = async ({ url, mode }) => {
  const records = [];
  const on = (e) => { try { records.push(...JSON.parse(e.detail).records); } catch (err) {} };
  document.addEventListener('sqh:pieces', on);
  // A video change replays this page's earlier pieces. Keep only records from this run.
  document.dispatchEvent(new CustomEvent('sqh:ping'));
  const floor = records.reduce((m, r) => (typeof r.seq === 'number' ? Math.max(m, r.seq) : m), 0);
  records.length = 0;
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:360px;background:#000';
  document.body.append(v);
  const ms = new MediaSource();
  v.src = URL.createObjectURL(ms);
  await new Promise((resolve, reject) => {
    ms.addEventListener('sourceopen', resolve, { once: true });
    setTimeout(() => reject(new Error('sourceopen timeout')), 4000);
  });
  const sb = ms.addSourceBuffer('video/mp4; codecs="avc1.640028"');
  const add = (b) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('append timeout')), 6000);
    sb.addEventListener('updateend', () => { clearTimeout(timer); resolve(); }, { once: true });
    sb.addEventListener('error', () => { clearTimeout(timer); reject(new Error('append error')); }, { once: true });
    try { sb.appendBuffer(b); } catch (e) { clearTimeout(timer); reject(e); }
  });
  if (mode === 'sequence') sb.mode = 'sequence';
  if (mode === 'window-end') sb.appendWindowEnd = 1;
  if (mode === 'window-start') sb.appendWindowStart = 1;
  if (mode === 'throw') {
    try { ms.endOfStream(); } catch (e) {}
    await new Promise((r) => setTimeout(r, 30));
    let thrown = null;
    try { sb.appendBuffer(buf); } catch (e) { thrown = e; }
    await new Promise((r) => setTimeout(r, 40));
    document.removeEventListener('sqh:pieces', on);
    return { same: !!thrown, name: thrown && thrown.name, records: records.filter((r) => typeof r.seq !== 'number' || r.seq > floor) };
  }
  if (mode === 'abort') {
    try { await add(buf.subarray(0, 240)); } catch (e) { try { sb.abort(); } catch (err) {} }
    try { sb.abort(); } catch (e) {}
    await new Promise((r) => setTimeout(r, 20));
  }
  if (mode === 'split') {
    let seed = 7, x = 0;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    while (x < buf.length) {
      const step = Math.max(1, Math.floor(rnd() * 17000));
      const n = Math.min(buf.length, x + step);
      await add(buf.subarray(x, n));
      x = n;
    }
  } else if (mode !== 'throw') await add(buf);
  try { if (ms.readyState === 'open') ms.endOfStream(); } catch (e) {}
  try { await v.play(); } catch (e) {}
  await new Promise((r) => setTimeout(r, 120));
  document.removeEventListener('sqh:pieces', on);
  return {
    records: records.filter((r) => typeof r.seq !== 'number' || r.seq > floor),
    width: v.videoWidth,
    buffered: v.buffered && v.buffered.length ? v.buffered.end(0) : 0,
  };
};

export async function measureChecks({ chromium, webkit, check, EXT, BASE, FIX, page }) {
  const truth = JSON.parse(fs.readFileSync(path.join(FIX, 'measure/reference.ffprobe.json'), 'utf8'));
  const trexTruth = JSON.parse(fs.readFileSync(path.join(FIX, 'measure/trex-reference.ffprobe.json'), 'utf8'));
  const ref = fs.readFileSync(path.join(FIX, 'measure/reference.mp4'));
  const trex = fs.readFileSync(path.join(FIX, 'measure/trex-reference.mp4'));
  const encv = fs.readFileSync(path.join(FIX, 'measure/synthetic-encv-init.m4s'));

  const api = loadApi();
  const full = summarize(api.feed(ref).records);
  const near = Math.abs(full.avg - truth.avgBps) / truth.avgBps < 0.001;
  check('Measure: reference.mp4 matches the committed frame bins', full.frames === truth.frames && full.keys === truth.keys && full.bytes === truth.bytes && binsMatch(full, truth) && near, JSON.stringify({ full, avg: truth.avgBps }));

  const trexGot = summarize(loadApi().feed(trex).records);
  const trexNear = Math.abs(trexGot.avg - trexTruth.avgBps) / trexTruth.avgBps < 0.001;
  check('Measure: trex-reference.mp4 matches its committed bins', trexGot.frames === trexTruth.frames && trexGot.bytes === trexTruth.bytes && trexGot.keys === trexTruth.keys && binsMatch(trexGot, trexTruth) && trexNear, JSON.stringify({ frames: trexGot.frames, bytes: trexGot.bytes, keys: trexGot.keys }));

  const encvGot = summarize(loadApi().feed(encv).records);
  check('Measure: encv init reports the original avc1 codec', !!(encvGot.tracks && encvGot.tracks[0] && encvGot.tracks[0].codec === 'avc1' && encvGot.vide === 1), JSON.stringify(encvGot.tracks));

  const w1 = summarize(loadApi().feed(ref, { w1: 1 }).records);
  check('Measure: appendWindowEnd 1 keeps the frames that end inside the window', w1.frames === 23 && w1.bytes === 1035567 && Math.abs(w1.max - 0.958333) < 0.001, JSON.stringify({ frames: w1.frames, bytes: w1.bytes, max: w1.max }));
  const w0 = summarize(loadApi().feed(ref, { w0: 1 }).records);
  check('Measure: appendWindowStart 1 starts at the next keyframe', w0.frames === 240 && w0.min >= 1.9 && w0.min < 2.1, JSON.stringify({ frames: w0.frames, min: w0.min }));
  const shortWin = summarize(loadApi().feed(ref, { w1: 0.04 }).records);
  check('Measure: a 0.04 s append window keeps no frame', shortWin.frames === 0, JSON.stringify({ frames: shortWin.frames, bytes: shortWin.bytes }));

  const init2 = fs.readFileSync(path.join(FIX, 'dash/init-2.m4s'));
  const chunk2 = fs.readFileSync(path.join(FIX, 'dash/chunk-2-00001.m4s'));
  const emptySplit = splitEmptyMdat(chunk2);
  const emptyApi = loadApi();
  emptyApi.feed(init2);
  const emptyPrefix = summarize(emptyApi.feed(emptySplit.prefix).records);
  const emptyRest = summarize(emptyApi.feed(emptySplit.rest).records);
  check('Measure: an empty mdat releases no frames, and the real mdat does', emptyPrefix.frames === 0 && emptyRest.frames === 96, JSON.stringify({ prefix: emptyPrefix.frames, rest: emptyRest.frames }));

  const named = Buffer.from(init2);
  const entryAt = sampleEntryOffset(named);
  named[entryAt + 50] = 8;
  named.write('frmahev1', entryAt + 51);
  const namedGot = summarize(loadApi().feed(named).records);
  check('Measure: a compressor name containing frmahev1 stays avc1', !!(namedGot.tracks && namedGot.tracks[0] && namedGot.tracks[0].codec === 'avc1'), JSON.stringify(namedGot.tracks));

  const capped = loadApi();
  capped.feed(init2);
  const overTrun = capped.feed(twoTrunMoof(1));
  check('Measure: trun sample counts in one append stop at 30000', summarize(overTrun.records).frames === 0 && overTrun.stopped === 'safety', JSON.stringify({ frames: summarize(overTrun.records).frames, stopped: overTrun.stopped }));

  const seq = loadApi().feed(ref, { mode: 'sequence' });
  check('Measure: sequence mode records nothing and says why', summarize(seq.records).frames === 0 && seq.records.some((r) => r.why === 'sequence'), JSON.stringify(seq.records.map((r) => r.t + ':' + r.why)));

  const failApi = loadApi();
  const failed = failApi.feed(ref, { fail: true });
  const after = failApi.feed(ref);
  check('Measure: a failed append records nothing, and the next one still parses', summarize(failed.records).frames === 0 && summarize(after.records).frames === 288, JSON.stringify({ failed: failed.records.length, after: summarize(after.records).frames }));

  const abortApi = loadApi();
  abortApi.feed(ref.subarray(0, 200), { abort: true });
  const aborted = summarize(abortApi.feed(ref).records);
  check('Measure: abort mid-fragment then a whole file matches the bins', aborted.frames === 288 && aborted.bytes === truth.bytes && aborted.keys === 6, JSON.stringify({ frames: aborted.frames, bytes: aborted.bytes }));

  let seed = 3, x = 0, pieces = 0;
  const splitApi2 = loadApi();
  const bag = [];
  const rnd2 = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  while (x < ref.length) {
    const n = Math.min(ref.length, x + Math.max(1, Math.floor(rnd2() * 9000)));
    bag.push(...splitApi2.feed(ref.subarray(x, n)).records);
    x = n;
    pieces++;
  }
  const splitGot = summarize(bag);
  check('Measure: random slices of reference.mp4 match the whole file', pieces > 100 && splitGot.frames === 288 && splitGot.bytes === truth.bytes && splitGot.keys === 6, JSON.stringify({ pieces, frames: splitGot.frames, bytes: splitGot.bytes }));

  let clock = 0;
  const killed = loadApi(() => (clock += 9)).feed(ref);
  check('Measure: a parse slower than 8 ms turns measurement off and keeps no frames', killed.stopped === 'killed' && summarize(killed.records).frames === 0, JSON.stringify({ stopped: killed.stopped, frames: summarize(killed.records).frames }));

  // ---- real extension, main world ----
  const url = BASE + 'measure/reference.mp4';
  await page.goto(BASE + 'plain.html');
  await page.evaluate(() => document.querySelectorAll('video').forEach((v) => v.remove()));
  let live;
  try { live = await page.evaluate(APPEND_JS, { url, mode: 'full' }); }
  catch (e) { live = { error: String(e) }; }
  const liveSum = summarize(dedupe(live.records));
  check('Measure: Chromium extension reader matches reference.mp4', !live.error && liveSum.frames === 288 && liveSum.bytes === truth.bytes && binsMatch(liveSum, truth), live.error || JSON.stringify({ frames: liveSum.frames, bytes: liveSum.bytes, keys: liveSum.keys, width: live.width }));

  const openPanel = async () => {
    await page.evaluate(() => {
      for (const v of document.querySelectorAll('video')) {
        if (v.videoWidth) continue;
        try {
          Object.defineProperty(v, 'videoWidth', { configurable: true, get: () => 1920 });
          Object.defineProperty(v, 'videoHeight', { configurable: true, get: () => 1080 });
        } catch (e) {}
      }
    });
    for (let i = 0; i < 3; i++) {
      const state = await page.evaluate(() => {
        const h = document.querySelector('[data-stream-quality-hud]');
        if (!h || !h.shadowRoot) return 'missing';
        const p = h.shadowRoot.querySelector('.p');
        return p && !p.hidden ? 'open' : 'closed';
      });
      if (state === 'open') break;
      await page.keyboard.press('Control+Shift+KeyH');
      await page.waitForTimeout(300);
    }
  };
  const panelText = async () => {
    await openPanel();
    await page.evaluate(() => {
      const d = document.querySelector('[data-stream-quality-hud]')?.shadowRoot?.querySelector('details');
      if (d && !d.open) d.querySelector('summary').click();
    });
    return page.evaluate(() => {
      const h = document.querySelector('[data-stream-quality-hud]');
      const root = h && h.shadowRoot;
      if (!root) return '(no HUD)';
      return (root.querySelector('.p') || root).innerText || '';
    });
  };

  const cost = await page.evaluate(() => new Promise((resolve) => {
    let parse = null, hud = null;
    const finish = () => { if (parse && hud) resolve({ parse, hud }); };
    document.addEventListener('sqh:parse-cost', (e) => { parse = JSON.parse(e.detail); finish(); }, { once: true });
    document.addEventListener('sqh:hud-cost-result', (e) => { hud = JSON.parse(e.detail); finish(); }, { once: true });
    document.dispatchEvent(new CustomEvent('sqh:cost'));
    document.dispatchEvent(new CustomEvent('sqh:hud-cost'));
    setTimeout(() => resolve({ parse, hud, timeout: true }), 2000);
  }));
  const parseP95 = p95(cost.parse || []);
  console.log('COST parse p95 ms ' + (parseP95 == null ? 'none' : parseP95.toFixed(3)) + ' account ' + (cost.hud && cost.hud.account != null ? cost.hud.account.toFixed(3) : 'none') + ' render ' + (cost.hud && cost.hud.render != null ? cost.hud.render.toFixed(3) : 'none'));
  check('Measure: hook parse p95 stays under 2 ms', parseP95 != null && parseP95 <= 2, JSON.stringify({ parseP95, n: (cost.parse || []).length, timeout: cost.timeout }));
  check('Measure: HUD accounting and render p95 are reported', !!(cost.hud && cost.hud.account > 0 && cost.hud.render > 0), JSON.stringify(cost.hud));

  const beforePing = await panelText();
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('sqh:ping')));
  await page.waitForTimeout(400);
  const afterPing = await panelText();
  const pieceLine = (beforePing.match(/(\d+) video pieces/) || [])[1];
  check('Measure: a second ping does not count the same pieces twice', pieceLine === '3' && /3 video pieces/.test(afterPing), beforePing + '\n---\n' + afterPing);

  await page.evaluate(() => document.querySelectorAll('video').forEach((v) => v.remove()));
  let win;
  try { win = await page.evaluate(APPEND_JS, { url, mode: 'window-end' }); }
  catch (e) { win = { error: String(e) }; }
  const winSum = summarize(dedupe(win.records));
  check('Measure: Chromium appendWindowEnd 1 matches the clipped frame count', !win.error && winSum.frames === 23 && winSum.bytes === 1035567, win.error || JSON.stringify({ frames: winSum.frames, bytes: winSum.bytes, max: winSum.max }));

  await page.evaluate(() => document.querySelectorAll('video').forEach((v) => v.remove()));
  let sliced;
  try { sliced = await page.evaluate(APPEND_JS, { url, mode: 'split' }); }
  catch (e) { sliced = { error: String(e) }; }
  const sliceSum = summarize(dedupe(sliced.records));
  check('Measure: Chromium random slices match the whole file', !sliced.error && sliceSum.frames === 288 && sliceSum.bytes === truth.bytes, sliced.error || JSON.stringify({ frames: sliceSum.frames, bytes: sliceSum.bytes }));

  await page.evaluate(() => document.querySelectorAll('video').forEach((v) => v.remove()));
  let abortedLive;
  try { abortedLive = await page.evaluate(APPEND_JS, { url, mode: 'abort' }); }
  catch (e) { abortedLive = { error: String(e) }; }
  const abortSum = summarize(dedupe(abortedLive.records));
  check('Measure: Chromium abort mid-fragment still reaches the full file', !abortedLive.error && abortSum.frames === 288 && abortSum.bytes === truth.bytes, abortedLive.error || JSON.stringify({ frames: abortSum.frames, bytes: abortSum.bytes }));

  await page.evaluate(() => document.querySelectorAll('video').forEach((v) => v.remove()));
  let thrown;
  try { thrown = await page.evaluate(APPEND_JS, { url, mode: 'throw' }); }
  catch (e) { thrown = { error: String(e) }; }
  check('Measure: an append the browser rejects rethrows that object and records nothing', !thrown.error && thrown.same && summarize(thrown.records).frames === 0, thrown.error || JSON.stringify(thrown));

  await page.evaluate(() => document.querySelectorAll('video').forEach((v) => v.remove()));
  let removal;
  try {
    removal = await page.evaluate(async (base) => {
      const records = [];
      const on = (e) => { try { records.push(...JSON.parse(e.detail).records); } catch (err) {} };
      document.addEventListener('sqh:pieces', on);
      const v = document.createElement('video');
      v.muted = true;
      v.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:360px';
      document.body.append(v);
      const ms = new MediaSource();
      const url = URL.createObjectURL(ms);
      v.src = url;
      await new Promise((resolve, reject) => {
        ms.addEventListener('sourceopen', resolve, { once: true });
        setTimeout(() => reject(new Error('sourceopen')), 4000);
      });
      const sb = ms.addSourceBuffer('video/mp4; codecs="avc1.640028"');
      const add = async (path) => {
        const buf = new Uint8Array(await (await fetch(base + path)).arrayBuffer());
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('append')), 6000);
          sb.addEventListener('updateend', () => { clearTimeout(timer); resolve(); }, { once: true });
          sb.addEventListener('error', () => { clearTimeout(timer); reject(new Error('append error')); }, { once: true });
          sb.appendBuffer(buf);
        });
      };
      await add('dash/init-2.m4s');
      await add('dash/chunk-2-00001.m4s');
      const ranges = () => Array.from({ length: sb.buffered.length }, (_, i) => [sb.buffered.start(i), sb.buffered.end(i)]);
      let conversions = 0;
      const start = { valueOf() { return ++conversions === 1 ? 1 : 0; } };
      const before = ranges();
      await new Promise((resolve, reject) => {
        sb.addEventListener('updateend', resolve, { once: true });
        try { sb.remove(start, 2); } catch (e) { reject(e); }
      });
      await new Promise((r) => setTimeout(r, 40));
      const after = ranges();
      const good = records.filter((r) => r.t === 'rm');
      const mark = records.length;
      let failed = '';
      try { sb.remove(-1, 1); } catch (e) { failed = e && e.name; }
      await new Promise((resolve) => {
        sb.addEventListener('updateend', resolve, { once: true });
        try { sb.appendBuffer(new Uint8Array()); } catch (e) { resolve(); }
      });
      await new Promise((r) => setTimeout(r, 40));
      const bad = records.slice(mark).filter((r) => r.t === 'rm');
      const beforeBye = records.filter((r) => r.t === 'bye').length;
      const ownerNow = () => new Promise((resolve) => {
        const timer = setTimeout(() => resolve('no answer'), 500);
        v.addEventListener('sqh:owner', (e) => { clearTimeout(timer); resolve(e.detail); }, { once: true });
        v.dispatchEvent(new CustomEvent('sqh:which'));
      });
      const ownerBefore = await ownerNow();
      // Players often revoke the address right after attaching; the video keeps playing from the same MediaSource.
      URL.revokeObjectURL(url);
      await new Promise((r) => setTimeout(r, 40));
      const revokeByes = records.filter((r) => r.t === 'bye').length - beforeBye;
      const ownerAfterRevoke = await ownerNow();
      v.removeAttribute('src');
      v.load();
      await new Promise((r) => setTimeout(r, 200));
      const byes = records.filter((r) => r.t === 'bye').length - beforeBye;
      document.removeEventListener('sqh:pieces', on);
      v.remove();
      return { conversions, good, bad, failed, byes, revokeByes, ownerBefore, ownerAfterRevoke, before, after };
    }, BASE);
  } catch (e) { removal = { error: String(e) }; }
  const removedSpans = (before, after) => {
    const gaps = [];
    for (const span of before || []) {
      let cuts = [[span[0], span[1]]];
      for (const keep of after || []) {
        const next = [];
        for (const c of cuts) {
          if (!(keep[1] > c[0] && keep[0] < c[1])) { next.push(c); continue; }
          if (keep[0] > c[0]) next.push([c[0], keep[0]]);
          if (keep[1] < c[1]) next.push([keep[1], c[1]]);
        }
        cuts = next;
      }
      for (const c of cuts) if (c[1] > c[0]) gaps.push(c);
    }
    return gaps;
  };
  const closeTime = (a, b) => Math.abs(a - b) < 1e-3;
  const gaps = removedSpans(removal.before, removal.after);
  const recordedGap = gaps.length > 0 && gaps.every((g) => (removal.good || []).some((r) => closeTime(r.start, g[0]) && closeTime(r.end, g[1])));
  check('Measure: remove keeps the native arguments and records only a successful range', !removal.error && removal.conversions === 1 && recordedGap && removal.bad.length === 0 && !!removal.failed, removal.error || JSON.stringify(removal));
  {
    // The reader's own transport: many separate deliveries must keep the replay backlog within 3 MB without stopping.
    const api = loadApi();
    const bus = api.createBus();
    const queue = [];
    const sent = [];
    const transport = api.createTransport(bus, { setTimeout: (fn) => { queue.push(fn); return queue.length; } }, (detail) => sent.push(detail.length));
    bus.sink = transport.sink;
    const samples = Array.from({ length: 6000 }, (_, i) => [i * 512, 512, 1000 + i, 1]);
    let peak = 0;
    for (let k = 0; k < 40; k++) {
      bus.emit({ t: 'f', ms: 'ms1', sb: 'sb1', samples });
      while (queue.length) queue.shift()();
      peak = Math.max(peak, transport.bytes());
    }
    const before = sent.length;
    transport.replay();
    const replayLen = sent.length > before ? sent[sent.length - 1] : 0;
    const cap = 3 * 1024 * 1024;
    check('Measure: the replay backlog stays within 3 MB across many deliveries', !bus.stopped && sent.length === 41 && peak <= cap && peak > cap * 0.9 && replayLen <= cap + 1024, JSON.stringify({ stopped: bus.stopped, deliveries: before, peak, replayLen }));
  }
  check('Measure: revoking the blob address keeps an attached reader', !removal.error && removal.revokeByes === 0 && /^ms/.test(removal.ownerBefore || '') && removal.ownerAfterRevoke === removal.ownerBefore, removal.error || JSON.stringify({ revokeByes: removal.revokeByes, ownerBefore: removal.ownerBefore, ownerAfterRevoke: removal.ownerAfterRevoke }));
  check('Measure: detaching a MediaSource releases its reader', !removal.error && removal.byes >= 1, removal.error || JSON.stringify({ byes: removal.byes }));

  await page.evaluate(() => document.querySelectorAll('video').forEach((v) => v.remove()));
  let sequenced;
  try { sequenced = await page.evaluate(APPEND_JS, { url, mode: 'sequence' }); }
  catch (e) { sequenced = { error: String(e) }; }
  const seqSum = summarize(dedupe(sequenced.records));
  check('Measure: Chromium sequence mode is unavailable', !sequenced.error && seqSum.frames === 0 && seqSum.whys.includes('sequence'), sequenced.error || JSON.stringify(seqSum.whys));
  let seqText = '';
  for (let i = 0; i < 10; i++) {
    seqText = await panelText();
    if (/places pieces in sequence mode/.test(seqText)) break;
    await page.waitForTimeout(200);
  }
  check('Measure: sequence mode shows its unavailable reason', /places pieces in sequence mode/.test(seqText), seqText.slice(0, 500));

  // Worker handle plus a hidden decoy that really appends the reference file.
  await page.goto(BASE + 'plain.html');
  await page.evaluate(() => document.querySelectorAll('video').forEach((v) => v.remove()));
  const worker = await page.evaluate(async (fileUrl) => {
    const buf = new Uint8Array(await (await fetch(fileUrl)).arrayBuffer());
    function MediaSourceHandle() {}
    const main = document.createElement('video');
    main.muted = true;
    main.playsInline = true;
    main.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:360px;background:#000';
    Object.defineProperty(main, 'srcObject', { configurable: true, get: () => new MediaSourceHandle(), set() {} });
    main.src = new URL('clip1080.mp4', location.href).href;
    document.body.append(main);
    await new Promise((resolve, reject) => {
      main.addEventListener('loadeddata', resolve, { once: true });
      setTimeout(() => reject(new Error('main frame timeout')), 4000);
    });
    const decoy = document.createElement('video');
    decoy.muted = true;
    decoy.style.display = 'none';
    document.body.append(decoy);
    const ms = new MediaSource();
    decoy.src = URL.createObjectURL(ms);
    await new Promise((resolve, reject) => {
      ms.addEventListener('sourceopen', resolve, { once: true });
      setTimeout(() => reject(new Error('decoy sourceopen')), 4000);
    });
    const sb = ms.addSourceBuffer('video/mp4; codecs="avc1.640028"');
    await new Promise((resolve, reject) => {
      sb.addEventListener('updateend', resolve, { once: true });
      sb.addEventListener('error', () => reject(new Error('decoy append')), { once: true });
      sb.appendBuffer(buf);
    });
    return { decoyBuffered: decoy.buffered.length ? decoy.buffered.end(0) : 0 };
  }, url);
  const workerText = await panelText();
  check('Measure: a worker handle stays unavailable and ignores the hidden decoy', worker.decoyBuffered > 0 && /background worker/.test(workerText) && !/Mbps average/.test(workerText), workerText.slice(0, 700));

  await page.goto(BASE + 'plain.html');
  const plainText = await panelText();
  check('Measure: a plain file says Media Source is not in use', /doesn\u2019t use Media Source/.test(plainText), plainText.slice(0, 400));

  await page.goto(BASE + 'mse.html?rep=2');
  await page.waitForFunction(() => document.title === 'playing', null, { timeout: 15000 });
  await page.waitForTimeout(8000);
  await openPanel();
  const pill = await page.evaluate(() => {
    const root = document.querySelector('[data-stream-quality-hud]').shadowRoot;
    const svg = root.querySelector('.measured svg');
    return {
      pill: root.querySelector('.pt').textContent,
      head: root.querySelector('.head').innerText,
      aria: svg ? svg.getAttribute('aria-label') || '' : '',
      fonts: svg ? svg.innerHTML : '',
      box: svg ? svg.getAttribute('viewBox') : '',
    };
  });
  check('Measure: the pill shows the running average once playback is long enough', /Mbps avg/.test(pill.pill) && /Mbps average/.test(pill.head) && /highest second/.test(pill.head) && /Average /.test(pill.aria), JSON.stringify(pill));
  check('Measure: chart text is at least 11 px inside the 56 px chart', /font-size="11"/.test(pill.fonts) && !/font-size="(?:8|9)"/.test(pill.fonts) && pill.box === '0 0 300 56', pill.box);

  // ---- same-world accounting ----
  const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const source = fs.readFileSync(path.join(EXT, 'hud.js'), 'utf8');
    await ctx.addInitScript({ content: source.replace(/\}\)\(\);\s*$/, `
      window.__sqh = {
        apply: applyPiece, tick: measureTick, view: measureView, reset: resetLedger,
        commit: commitRange, measured, bench: measureBench, html: headHtml,
        stopTimer() { clearInterval(measureTimer); measureTimer = null; },
      };
    })();`) });
    const acc = await ctx.newPage();
    await acc.setContent('<!doctype html><video id=v muted style="width:640px;height:360px"></video>');
    const accounting = await acc.evaluate(() => {
      const q = window.__sqh;
      q.stopTimer();
      const v = document.getElementById('v');
      v.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:360px';
      v.checkVisibility = () => true;
      // paused is read-only on a real element, so the late-join clock can be driven without playback.
      let pausedFlag = true;
      Object.defineProperty(v, 'paused', { configurable: true, get: () => pausedFlag, set: (val) => { pausedFlag = !!val; } });
      let w = 1920, h = 1080;
      Object.defineProperty(v, 'videoWidth', { get: () => w });
      Object.defineProperty(v, 'videoHeight', { get: () => h });
      Object.defineProperty(v, 'videoTracks', { get: () => [{ selected: true, configuration: { codec: 'avc1.640028' } }] });
      v.play = () => Promise.resolve();
      const arm = () => {
        q.reset();
        q.measured.video = v;
        q.measured.owner = 'ms1';
        q.measured.reader = true;
        q.measured.moov = true;
        q.measured.reason = '';
      };
      const sample = (pts, dur, bytes, seq) => ({ t: 'f', ms: 'ms1', sb: 'sb', seq, session: 'acct', timescale: 1000, offset: 0, cfg: { codec: 'avc1', w: 1920, h: 1080 }, samples: [[Math.round(pts * 1000), Math.round(dur * 1000), bytes, 1]] });
      arm();
      q.apply(sample(0, 1, 8000, 1));
      q.commit(v, 0, 0.25); q.commit(v, 0.25, 0.5); q.commit(v, 0.5, 0.75); q.commit(v, 0.75, 1);
      const four = { bytes: q.measured.committedBytes, dur: q.measured.committedDur };
      q.commit(v, 0.25, 0.75);
      const afterSeek = { bytes: q.measured.committedBytes, dur: q.measured.committedDur };
      arm();
      q.apply(sample(0, 1, 8000, 1));
      q.commit(v, 0, 1);
      const one = { bytes: q.measured.committedBytes, dur: q.measured.committedDur };
      arm();
      q.apply(sample(0.5, 1, 1000, 1));
      q.commit(v, 0.5, 1.5);
      const edges = { s0: q.measured.seconds.get(0), s1: q.measured.seconds.get(1) };
      arm();
      q.apply(sample(0, 1, 8000, 1));
      q.commit(v, 0, 1);
      const watched = q.measured.committedBytes;
      q.apply({ t: 'rm', ms: 'ms1', seq: 2, session: 'acct', start: 0, end: 2 });
      v.paused = true;
      q.measured.prev = { t: 1, wall: 0, seeking: false };
      q.tick();
      const paused = q.measured.committedBytes;
      arm();
      q.apply(sample(0, 1, 8000, 1));
      q.apply(sample(0, 1, 8000, 1));
      const dup = q.measured.pieces;
      arm();
      q.apply({ t: 'init', ms: 'ms1', sb: 'a', vide: 1, seq: 1, session: 'tr' });
      q.apply({ t: 'init', ms: 'ms1', sb: 'a', vide: 1, seq: 2, session: 'tr' });
      const replaced = q.view(v).blocked;
      arm();
      q.apply({ t: 'init', ms: 'ms1', sb: 'a', vide: 1, seq: 1, session: 'tr2' });
      q.apply({ t: 'init', ms: 'ms1', sb: 'b', vide: 1, seq: 2, session: 'tr2' });
      const several = q.view(v).blocked;
      arm();
      q.apply({ t: 'st', why: 'sequence', seq: 1, session: 'st' });
      const sequence = q.view(v).blocked;
      arm();
      q.apply({ t: 'f', ms: 'ms1', seq: 1, session: 'k', timescale: 1000, cfg: { codec: 'avc1' }, samples: [[0, 1000, 100, null]] });
      const keys = q.view(v).blocked;
      arm();
      let wall = 0;
      const orig = performance.now.bind(performance);
      performance.now = () => wall;
      q.measured.moov = false;
      q.measured.prev = null;
      v.paused = false;
      v.currentTime = 0;
      q.tick();
      wall = 60000;
      v.currentTime = 0.2;
      q.tick();
      const joined = q.view(v).blocked;
      performance.now = orig;
      arm();
      v.paused = false;
      for (let i = 0; i < 180; i++) q.apply(sample(i, 1, 1000000, i + 1));
      for (let i = 0; i < 180; i++) q.apply(Object.assign(sample(180 + i, 1, 375000, 181 + i), { cfg: { codec: 'avc1', w: 1280, h: 720 } }));
      q.commit(v, 0, 180);
      w = 1280; h = 720;
      q.commit(v, 180, 360);
      const view = q.view(v);
      arm();
      q.apply({ t: 'f', ms: 'ms1', sb: 'sb', seq: 1, session: 'ov', timescale: 1000, cfg: { codec: 'avc1' }, samples: [[0, 1000, 100, 1], [1000, 1000, 100, 0], [2000, 1000, 100, 1]] });
      q.apply({ t: 'rm', ms: 'ms1', seq: 2, session: 'ov', start: 0.5, end: 1.5 });
      const overlap = q.measured.pending.map((s) => [s.t0, s.t1]);
      arm();
      const rep = [[0, 1000, 100, 1], [1000, 1000, 100, 0], [2000, 1000, 300, 1]];
      for (let i = 3; i < 10; i++) rep.push([i * 1000, 1000, 100, 1]);
      q.apply({ t: 'f', ms: 'ms1', sb: 'sb', seq: 1, session: 'rep', timescale: 1000, cfg: { codec: 'avc1' }, samples: rep });
      q.apply({ t: 'f', ms: 'ms1', sb: 'sb', seq: 2, session: 'rep', timescale: 1000, cfg: { codec: 'avc1' }, samples: [[500, 500, 999, 1]] });
      q.commit(v, 0, 10);
      const replacedView = q.view(v);
      const replacement = { dur: q.measured.committedDur, bytes: q.measured.committedBytes, coverage: replacedView.coverage, ready: replacedView.ready, avg: replacedView.avg };
      arm();
      q.apply({ t: 'f', ms: 'ms1', sb: 'sb', seq: 1, session: 'sw', timescale: 1000, cfg: { codec: 'avc1' }, samples: [[0, 1000, 100, 1]] });
      q.commit(v, 0, 1);
      q.apply({ t: 'f', ms: 'ms2', sb: 'sb2', seq: 2, session: 'sw', timescale: 1000, cfg: { codec: 'avc1' }, samples: [[0, 1000, 1000, 1]] });
      q.measured.owner = 'ms2';
      q.commit(v, 0, 1);
      const switchedBytes = q.measured.committedBytes;
      arm();
      for (let i = 0; i < 8; i++) q.apply({ t: 'f', ms: 'ms1', sb: 'sb', seq: i + 1, session: 'cap', timescale: 1000, cfg: { codec: 'avc1' }, samples: Array.from({ length: 30000 }, (_, j) => [(i * 30000 + j) * 40, 40, 100, 1]) });
      const pendingCap = { pending: q.measured.pending.length, reason: q.measured.reason };
      arm();
      w = 1920; h = 1080;
      q.apply({ t: 'f', ms: 'ms1', sb: 'sb', seq: 1, session: 'cfg', timescale: 1000, cfg: { codec: 'avc1' }, samples: Array.from({ length: 2000 }, (_, j) => [j * 1000, 1000, 1000000, 1]) });
      q.commit(v, 0, 2000);
      w = 1280; h = 720;
      q.apply({ t: 'f', ms: 'ms1', sb: 'sb', seq: 2, session: 'cfg', timescale: 1000, cfg: { codec: 'avc1' }, samples: Array.from({ length: 120 }, (_, j) => [(2000 + j) * 1000, 1000, 375000, 1]) });
      q.commit(v, 2000, 2200);
      const cfgView = q.view(v);
      let cfgDur = 0, cfgUnion = 0;
      q.measured.configs.forEach((cfg) => {
        if (cfg.w === 1280 && cfg.h === 720) {
          cfgDur = cfg.dur;
          cfgUnion = (cfg.union || []).reduce((n, part) => n + (part[1] - part[0]), 0);
        }
      });
      w = 1920; h = 1080;
      arm();
      q.apply({ t: 'f', ms: 'ms1', sb: 'sb', seq: 1, session: 'fps', timescale: 1000, cfg: { codec: 'avc1' }, samples: Array.from({ length: 145 }, (_, j) => [j * 40, 40, 100, 1]) });
      q.commit(v, 0.01, 5.79);
      const fps = q.view(v).fps;
      arm();
      q.apply({ t: 'f', ms: 'ms1', sb: 'sb', seq: 1, session: 'nofull', timescale: 1000, cfg: { codec: 'avc1' }, samples: Array.from({ length: 6 }, (_, i) => [i * 1000, 950, 1000000, 1]) });
      q.commit(v, 0, 6);
      const noFull = q.view(v);
      const noFullHtml = q.html({ kicker: 'k', overview: { picture: '1080p', grade: null, gradeReason: 'n' }, measure: noFull });
      return {
        four, one, afterSeek, edges: { b0: edges.s0 && edges.s0.bytes, b1: edges.s1 && edges.s1.bytes },
        watched, paused, dup, replaced, several, sequence, keys, joined,
        grade: view.grade, shares: view.shares, ready: view.ready,
        overlap, replacement, switchedBytes, pendingCap, cfgGrade: cfgView.grade, cfgDur, cfgUnion, fps,
        noFull: { ready: noFull.ready, full: noFull.fullSeconds, high: noFull.highText, html: noFullHtml, aria: (noFull.svg || '').match(/aria-label="([^"]*)"/)?.[1] || '' },
      };
    });
    const same = accounting.four.bytes === accounting.one.bytes && accounting.four.dur === accounting.one.dur && accounting.afterSeek.bytes === accounting.four.bytes;
    check('Measure: quarter-second commits match one second, and a revisit does not double count', same && accounting.four.bytes === 8000, JSON.stringify(accounting));
    check('Measure: a sample split by a second boundary keeps both parts', accounting.edges.b0 === 500 && accounting.edges.b1 === 500, JSON.stringify(accounting.edges));
    check('Measure: remove while paused leaves watched bytes unchanged', accounting.paused === accounting.watched && accounting.watched === 8000, JSON.stringify({ watched: accounting.watched, paused: accounting.paused }));
    check('Measure: a repeated sequence number is counted once', accounting.dup === 1, JSON.stringify(accounting.dup));
    check('Measure: one source buffer re-inited is still one video track', accounting.replaced === '', JSON.stringify(accounting.replaced));
    check('Measure: two video tracks on one MediaSource are unavailable', /Several video tracks/.test(accounting.several), JSON.stringify(accounting.several));
    check('Measure: sequence, unknown keyframes and a late join name their reasons', /sequence mode/.test(accounting.sequence) && /keyframes/.test(accounting.keys) && /started before the HUD/.test(accounting.joined), JSON.stringify(accounting));
    check('Measure: mixed sizes share watched time and the grade uses only the current size', /1080p 50%/.test(accounting.shares) && /720p 50%/.test(accounting.shares) && accounting.grade && accounting.grade.w === 1280 && accounting.grade.h === 720 && Math.abs(accounting.grade.bps - 3000000) < 1, JSON.stringify({ shares: accounting.shares, grade: accounting.grade }));
    check('Measure: a removal drops overlapping samples through the next keyframe', JSON.stringify(accounting.overlap) === JSON.stringify([[2, 3]]), JSON.stringify(accounting.overlap));
    const repOk = accounting.replacement && accounting.replacement.dur === 8.5 && accounting.replacement.bytes === 1999 && Math.abs(accounting.replacement.coverage - 0.85) < 1e-9 && accounting.replacement.ready === false && Math.abs(accounting.replacement.avg - (1999 * 8) / 8.5) < 1e-6;
    check('Measure: replacing an overlapping interval drops the dependent frames', repOk, JSON.stringify(accounting.replacement));
    check('Measure: a new MediaSource on the same element drops the old watch', accounting.switchedBytes === 1000, JSON.stringify(accounting.switchedBytes));
    check('Measure: pending samples stop at 200000 before the next insert', accounting.pendingCap && accounting.pendingCap.pending === 180000 && accounting.pendingCap.reason === 'safety', JSON.stringify(accounting.pendingCap));
    check('Measure: a grade uses that configuration’s own coverage', accounting.cfgGrade == null && accounting.cfgDur === 120 && Math.abs(accounting.cfgUnion - 200) < 1e-6, JSON.stringify({ grade: accounting.cfgGrade, dur: accounting.cfgDur, union: accounting.cfgUnion }));
    check('Measure: frame rate comes from the sample duration', Math.abs(accounting.fps - 25) < 1e-6, JSON.stringify(accounting.fps));
    const noFullOk = accounting.noFull && accounting.noFull.ready && accounting.noFull.full === false && accounting.noFull.high === '' && /highest second and range need a full measured second/.test(accounting.noFull.html) && !/0\.0/.test(accounting.noFull.aria || '');
    check('Measure: no complete second omits a zero highest second', noFullOk, JSON.stringify(accounting.noFull));
  } finally {
    await browser.close();
  }

  // ---- Safari allowlist and CSP (userscript path) ----
  const hook = fs.readFileSync(path.join(EXT, 'page-hook.js'), 'utf8');
  const hud = fs.readFileSync(path.join(EXT, 'hud.js'), 'utf8');
  const wk = await webkit.launch({ headless: true });
  try {
    const visit = async (origin, headers, body) => {
      const ctx = await wk.newContext();
      let reports = 0;
      await ctx.addInitScript({ content: `
        globalThis.__gm = { get: 0, set: 0 };
        globalThis.GM_getValue = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? (d == null ? '' : d) : v; } catch (e) { return d == null ? '' : d; } };
        globalThis.GM_setValue = (k, v) => { try { localStorage.setItem(k, String(v)); } catch (e) {} };
        globalThis.GM = {
          getValue: (k, d) => { globalThis.__gm.get++; return Promise.resolve(GM_getValue(k, d)); },
          setValue: (k, v) => { globalThis.__gm.set++; return Promise.resolve(GM_setValue(k, v)); },
        };
        globalThis.SQH_PAGE_HOOK_SOURCE = ${JSON.stringify(hook)};
      ` });
      await ctx.addInitScript({ content: hud });
      await ctx.route('**/*', (route) => {
        const req = route.request();
        if (req.method() === 'POST' && /csp-report|\/report/.test(req.url())) {
          reports++;
          return route.fulfill({ status: 204, body: '' });
        }
        if (req.url().startsWith(origin)) return route.fulfill({ status: 200, contentType: 'text/html', headers, body });
        return route.abort();
      });
      const pg = await ctx.newPage();
      const open = async () => {
        const before = reports;
        await pg.goto(origin + '/play/hudtest');
        await pg.evaluate(() => {
          const v = document.querySelector('video') || document.body.appendChild(document.createElement('video'));
          v.muted = true;
          v.style.cssText = 'width:640px;height:360px';
          try {
            Object.defineProperty(v, 'videoWidth', { configurable: true, get: () => 1920 });
            Object.defineProperty(v, 'videoHeight', { configurable: true, get: () => 1080 });
          } catch (e) {}
        });
        await pg.keyboard.press('Control+Shift+KeyH');
        await pg.waitForTimeout(400);
        const state = await pg.evaluate(() => ({
          hooked: !!globalThis[Symbol.for('sqh.reader')],
          gm: globalThis.__gm ? { get: globalThis.__gm.get, set: globalThis.__gm.set } : { get: 0, set: 0 },
          stored: localStorage.getItem('sqh.reader.blocked') || '',
          text: (document.querySelector('[data-stream-quality-hud]') || { shadowRoot: null }).shadowRoot
            ? document.querySelector('[data-stream-quality-hud]').shadowRoot.querySelector('.p').innerText
            : '',
        }));
        return { reports: reports - before, ...state };
      };
      const first = await open();
      const second = await open();
      await ctx.close();
      return { first, second };
    };
    const pageBody = '<!doctype html><title>csp</title><video muted style="width:640px;height:360px"></video>';
    const allow = await visit('https://www.disneyplus.com', { 'Content-Security-Policy': "script-src 'self' 'unsafe-inline'; report-uri /csp-report" }, pageBody);
    check('Measure: Safari on an allowlisted host injects and an allowing policy sends no report', allow.first.hooked && allow.first.reports === 0 && allow.second.reports === 0, JSON.stringify(allow));
    const reportAllow = await visit('https://www.disneyplus.com', { 'Content-Security-Policy-Report-Only': "script-src 'self' 'unsafe-inline'; report-uri /csp-report" }, pageBody);
    check('Measure: a report-only policy that allows inline scripts sends no report', reportAllow.first.hooked && reportAllow.first.reports === 0 && reportAllow.second.reports === 0, JSON.stringify(reportAllow));
    const block = await visit('https://www.disneyplus.com', { 'Content-Security-Policy': "script-src 'self'; report-uri /csp-report" }, pageBody);
    check('Measure: a blocking policy reports at most once, then not again', block.first.reports <= 1 && block.second.reports === 0, JSON.stringify(block));
    check('Measure: a blocking host is read and written with GM storage', block.first.gm.get >= 1 && block.first.gm.set >= 1 && block.second.gm.get >= 1 && block.second.reports === 0 && !block.second.hooked, JSON.stringify(block));
    const reportBlock = await visit('https://www.disneyplus.com', { 'Content-Security-Policy-Report-Only': "script-src 'self'; report-uri /csp-report" }, pageBody);
    const firstMeasured = reportBlock.first.hooked && !/blocked the HUD/.test(reportBlock.first.text) && !/isn\u2019t running/.test(reportBlock.first.text);
    check('Measure: report-only blocking still measures this page, and the next visit is silent', reportBlock.first.reports <= 1 && reportBlock.second.reports === 0 && firstMeasured, JSON.stringify(reportBlock));
    const elsewhere = await visit('https://example.com', { 'Content-Security-Policy': "script-src 'self'; report-uri /csp-report" }, pageBody);
    check('Measure: Safari off the checked services does not inject and does not report', !elsewhere.first.hooked && elsewhere.first.reports === 0 && /services checked for it/.test(elsewhere.first.text), JSON.stringify(elsewhere));
  } finally {
    await wk.close();
  }
}
