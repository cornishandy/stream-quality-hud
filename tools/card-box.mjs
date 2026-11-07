#!/usr/bin/env node
// Loopback card box for Stream Quality HUD. Binds 127.0.0.1 only. Stores the latest confirmed
// film card per browser under ~/Library/Caches (not iCloud). A card is a size, codec, listed
// bitrate, colour and timing. Playlist URLs, segment URLs and cookies are rejected.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const PORT = 9791;
const TTL = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY = 4096;
const MAX_CARDS = 80;
const BROWSERS = new Set(['chrome', 'safari', 'firefox', 'edge', 'orion']);
let file = process.env.SQHUD_CARDS || path.join(os.homedir(), 'Library', 'Caches', 'stream-quality-hud', 'cards.json');

function sanitize(input, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const id = typeof input.id === 'string' ? input.id : '';
  const slash = id.indexOf('/');
  if (slash < 1 || id.length > 220 || id.includes('..')) return null;
  const host = id.slice(0, slash);
  if (host !== host.toLowerCase() || !/^[a-z0-9.-]+$/.test(host) || !/^[\w./~:@%+-]*$/.test(id.slice(slash + 1))) return null;
  if (!BROWSERS.has(input.browser)) return null;
  if (typeof input.at !== 'number' || !(input.at > 0) || now - input.at > TTL || input.at > now + 60000) return null;
  const t = input.top;
  if (!t || typeof t !== 'object') return null;
  const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  if (!num(t.w, 1, 8000) || !num(t.h, 1, 8000) || !num(t.bps, 0, 1e9) || !num(t.fps, 0, 240)) return null;
  if (typeof t.tag !== 'string' || t.tag.length < 2 || t.tag.length > 12) return null;
  if (typeof t.codec !== 'string' || t.codec.length > 40) return null;
  if (typeof t.hdr !== 'boolean' || typeof t.includesSound !== 'boolean') return null;
  if (input.timing !== 'even' && input.timing !== 'uneven' && input.timing !== 'unknown') return null;
  if (typeof input.altered !== 'boolean' || typeof input.screenHdr !== 'boolean') return null;
  let page = '';
  if (input.page) {
    if (typeof input.page !== 'string' || input.page.length > 300 || !/^https?:\/\/[^\s?#]+$/.test(input.page)) return null;
    page = input.page;
  }
  if (/[.]m3u8|[.]mpd|[.]m4s|cookie|authorization/i.test(id + ' ' + page + ' ' + t.codec + ' ' + t.tag)) return null;
  return {
    v: 1, id, page, browser: input.browser, at: input.at, screenHdr: input.screenHdr,
    top: { w: t.w, h: t.h, tag: t.tag, codec: t.codec, bps: t.bps, includesSound: t.includesSound, hdr: t.hdr, fps: t.fps },
    timing: input.timing, altered: input.altered,
  };
}

function load(now = Date.now()) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(raw) ? raw.map((c) => sanitize(c, now)).filter(Boolean).slice(-MAX_CARDS) : [];
  } catch (e) { return []; }
}

function save(cards) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cards.slice(-MAX_CARDS)));
  fs.renameSync(tmp, file);
}

function putCard(input, now = Date.now()) {
  const card = sanitize(input, now);
  if (!card) return { status: 400, body: { ok: false } };
  const rest = load(now).filter((c) => !(c.id === card.id && c.browser === card.browser));
  rest.push(card);
  save(rest);
  return { status: 200, body: { ok: true } };
}

function getCards(id, now = Date.now()) {
  if (typeof id !== 'string' || id.length > 220) return { status: 200, body: { cards: [] } };
  return { status: 200, body: { cards: load(now).filter((c) => c.id === id) } };
}

function sample(over = {}) {
  return {
    v: 1, id: 'hulu.com/watch/0c32cedb-9657-48e2-9111-3ffda10df276', page: 'https://www.hulu.com/watch/0c32cedb-9657-48e2-9111-3ffda10df276',
    browser: 'chrome', at: Date.now(), screenHdr: false,
    top: { w: 1280, h: 720, tag: '720p', codec: 'H.264', bps: 6400000, includesSound: false, hdr: false, fps: 24 },
    timing: 'uneven', altered: true, manifest: 'https://example.com/master.m3u8', ...over,
  };
}

function check() {
  const now = Date.now();
  const kept = sanitize(sample(), now);
  assert.equal(kept.browser, 'chrome');
  assert.equal('manifest' in kept, false);
  assert.equal(sanitize(sample({ page: 'https://www.hulu.com/playlist.m3u8' }), now), null);
  assert.equal(sanitize(sample({ id: 'hulu.com/watch/file.mpd' }), now), null);
  assert.equal(sanitize(sample({ at: now - TTL - 1000 }), now), null);
  assert.equal(sanitize(sample({ browser: 'curl' }), now), null);
  assert.equal(sanitize(sample({ top: { ...sample().top, bps: 1e12 } }), now), null);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqhud-cards-'));
  file = path.join(dir, 'cards.json');
  assert.equal(putCard(sample(), now).status, 200);
  assert.equal(putCard(sample({ browser: 'safari', top: { ...sample().top, bps: 2500000, includesSound: true } }), now).status, 200);
  assert.equal(putCard({ ...sample(), url: 'https://cdn.example/seg.m4s' }, now).status, 200);
  const mine = getCards(sample().id, now).body.cards;
  assert.equal(mine.length, 2);
  assert.equal(JSON.stringify(mine).includes('m3u8'), false);
  assert.equal(JSON.stringify(mine).includes('m4s'), false);
  assert.equal(getCards('other.example/watch/1', now).body.cards.length, 0);
  assert.equal(putCard(sample({ at: now - TTL - 5000 }), now).status, 400);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('card box checks passed');
}

function cors(req, res) {
  const origin = req.headers.origin || '';
  if (/^[\w.+-]+:\/\/[^\s,]+$/.test(origin) && origin.length < 200) res.setHeader('Access-Control-Allow-Origin', origin);
  else res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function send(req, res, status, body) {
  cors(req, res);
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(json) });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('too big'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function onRequest(req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (req.method === 'OPTIONS') {
    cors(req, res);
    res.writeHead(204);
    res.end();
    return;
  }
  try {
    if (req.method === 'GET' && url.pathname === '/cards') {
      const out = getCards(url.searchParams.get('id') || '');
      send(req, res, out.status, out.body);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/cards') {
      let input = null;
      try { input = JSON.parse(await readBody(req)); } catch (e) { send(req, res, 400, { ok: false }); return; }
      const out = putCard(input);
      send(req, res, out.status, out.body);
      return;
    }
  } catch (e) {
    send(req, res, 400, { ok: false });
    return;
  }
  send(req, res, 404, { ok: false });
}

if (process.argv.includes('--check')) {
  check();
} else {
  http.createServer(onRequest).listen(PORT, '127.0.0.1', () => {
    console.log('card box on http://127.0.0.1:' + PORT + ' storing ' + file);
  });
}
