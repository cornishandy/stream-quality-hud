/*sqh-reader*/
(function (g) {
  'use strict';
  var CAP = 1024 * 1024;
  var SAMPLE_CAP = 30000;
  var QUEUE_CAP = 600;
  var QUEUE_BYTES = 3 * 1024 * 1024;
  var PIN_CAP = 16;
  var VERSION = '1.13.1';

  function u32(b, o) {
    return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  }
  function u64(b, o) {
    return u32(b, o) * 4294967296 + u32(b, o + 4);
  }
  function i32(b, o) {
    return u32(b, o) | 0;
  }
  function i64(b, o) {
    return i32(b, o) * 4294967296 + u32(b, o + 4);
  }
  function fourcc(b, o) {
    return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  }
  function ascii(b, o) {
    for (var i = 0; i < 4; i++) if (b[o + i] < 0x20 || b[o + i] > 0x7e) return false;
    return true;
  }
  function children(buf, start, end) {
    var out = [];
    var p = start;
    while (p + 8 <= end) {
      var sz = u32(buf, p);
      var h = 8;
      if (sz === 1) {
        if (p + 16 > end) break;
        sz = u64(buf, p + 8);
        h = 16;
      } else if (sz === 0) sz = end - p;
      if (!(sz >= h) || p + sz > end) break;
      out.push({ type: fourcc(buf, p + 4), payload: p + h, end: p + sz });
      p += sz;
    }
    return out;
  }
  function child(buf, box, type) {
    if (!box) return null;
    var list = children(buf, box.payload, box.end);
    for (var i = 0; i < list.length; i++) if (list[i].type === type) return list[i];
    return null;
  }
  // encv/enca hide the real codec in a sinf/frma child. The compressor-name
  // field can contain those same four bytes, so this walk never scans raw bytes.
  function originalCodec(buf, entryStart, entryEnd, type) {
    var origins = type === 'encv' ? [86] : [36, 52];
    for (var oi = 0; oi < origins.length; oi++) {
      var from = entryStart + origins[oi];
      if (from >= entryEnd) continue;
      var list = children(buf, from, entryEnd);
      for (var i = 0; i < list.length; i++) {
        if (list[i].type !== 'sinf') continue;
        var frma = child(buf, list[i], 'frma');
        if (!frma || frma.payload + 4 > frma.end) continue;
        return fourcc(buf, frma.payload);
      }
    }
    return type;
  }

  function newParser(ms, sb) {
    return {
      ms: ms, sb: sb, hdr: [], hdrNeed: 8, phase: 'hdr', kind: '', left: 0, size0: false,
      copy: null, filled: 0, boxType: '', needRap: true, moovSeen: false, joinedLate: false,
      firstDecided: false, sawAny: false, dead: false, tracks: [], trex: new Map(),
      waiters: [], ready: [], pendingInits: [], sent: {}, vide: 0, win: { offset: 0, w0: 0, w1: Infinity },
      pos: 0, moofAt: 0, mdatAt: 0, arrived: [], appendCount: 0, pendingRemove: null,
    };
  }
  function snapOf(st) {
    return {
      hdr: st.hdr.slice(), hdrNeed: st.hdrNeed, phase: st.phase, kind: st.kind, left: st.left,
      size0: st.size0, copy: st.copy, filled: st.filled, boxType: st.boxType, needRap: st.needRap,
      moovSeen: st.moovSeen, joinedLate: st.joinedLate, firstDecided: st.firstDecided, sawAny: st.sawAny,
      dead: st.dead, tracks: st.tracks, trex: st.trex, waiters: st.waiters.slice(), readyLen: st.ready.length,
      inits: st.pendingInits.slice(), sent: Object.assign({}, st.sent), vide: st.vide,
      pos: st.pos, moofAt: st.moofAt, mdatAt: st.mdatAt, appendCount: st.appendCount,
      arrived: st.arrived.map(function (r) { return [r[0], r[1]]; }),
    };
  }
  function restore(st, s) {
    st.hdr = s.hdr; st.hdrNeed = s.hdrNeed; st.phase = s.phase; st.kind = s.kind; st.left = s.left;
    st.size0 = s.size0; st.copy = s.copy; st.filled = s.filled; st.boxType = s.boxType; st.needRap = s.needRap;
    st.moovSeen = s.moovSeen; st.joinedLate = s.joinedLate; st.firstDecided = s.firstDecided; st.sawAny = s.sawAny;
    st.dead = s.dead; st.tracks = s.tracks; st.trex = s.trex; st.waiters = s.waiters; st.ready.length = s.readyLen;
    st.pendingInits = s.inits; st.sent = s.sent; st.vide = s.vide;
    st.pos = s.pos; st.moofAt = s.moofAt; st.mdatAt = s.mdatAt; st.appendCount = s.appendCount; st.arrived = s.arrived;
  }
  function resetPartial(st) {
    st.hdr = []; st.hdrNeed = 8; st.phase = 'hdr'; st.kind = ''; st.left = 0; st.size0 = false;
    st.copy = null; st.filled = 0; st.boxType = ''; st.waiters = []; st.ready = []; st.pendingInits = [];
  }

  function createBus() {
    var bus = {
      session: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
      seq: 0, stopped: '', closed: false, sink: function () {}, parseTimes: [], recent: [],
      pinned: new Map(), pending: [], flushTimer: 0, parsers: [],
    };
    bus.emit = function (rec) {
      if (bus.closed) return;
      rec.session = bus.session;
      rec.seq = ++bus.seq;
      bus.sink(rec);
    };
    bus.halt = function (why) {
      if (bus.stopped) return;
      bus.stopped = why;
      bus.emit({ t: 'st', why: why, ms: '', sb: '' });
      bus.closed = true;
    };
    bus.noteTime = function (dt) {
      bus.parseTimes.push(dt);
      if (bus.parseTimes.length > 5000) bus.parseTimes.shift();
      var now = g.performance && g.performance.now ? g.performance.now() : 0;
      bus.recent.push({ t: now, dt: dt });
      var i = 0;
      while (i < bus.recent.length && now - bus.recent[i].t > 60000) i++;
      if (i) bus.recent.splice(0, i);
    };
    bus.over = function (dt) {
      if (dt > 8) return true;
      var s = 0;
      for (var i = 0; i < bus.recent.length; i++) s += bus.recent[i].dt;
      return s > 600;
    };
    return bus;
  }

  function status(bus, st, why) {
    if (st.sent[why]) return;
    st.sent[why] = true;
    bus.emit({ t: 'st', why: why, ms: st.ms, sb: st.sb });
  }

  function parseStsd(buf, box) {
    var entries = [];
    if (!box) return entries;
    var count = u32(buf, box.payload + 4);
    var p = box.payload + 8;
    for (var i = 0; i < count && p + 8 <= box.end; i++) {
      var sz = u32(buf, p);
      if (sz < 8 || p + sz > box.end) break;
      var type = fourcc(buf, p + 4);
      var w = sz >= 36 ? (buf[p + 32] << 8) | buf[p + 33] : 0;
      var h = sz >= 36 ? (buf[p + 34] << 8) | buf[p + 35] : 0;
      var codec = (type === 'encv' || type === 'enca') ? originalCodec(buf, p, p + sz, type) : type;
      entries.push({ type: type, codec: codec, w: w, h: h });
      p += sz;
    }
    return entries;
  }
  function parseElst(buf, trak) {
    var edts = child(buf, trak, 'edts');
    var elst = child(buf, edts, 'elst');
    if (!elst) return { ok: true, mediaTime: 0 };
    var ver = buf[elst.payload];
    var n = u32(buf, elst.payload + 4);
    var p = elst.payload + 8;
    var entries = [];
    for (var i = 0; i < n; i++) {
      var mediaTime, rateInt, rateFrac, step;
      if (ver === 1) {
        if (p + 20 > elst.end) return { ok: false };
        mediaTime = i64(buf, p + 8);
        rateInt = (buf[p + 16] << 8) | buf[p + 17];
        rateFrac = (buf[p + 18] << 8) | buf[p + 19];
        step = 20;
      } else {
        if (p + 12 > elst.end) return { ok: false };
        mediaTime = i32(buf, p + 4);
        rateInt = (buf[p + 8] << 8) | buf[p + 9];
        if (rateInt & 0x8000) rateInt -= 0x10000;
        rateFrac = (buf[p + 10] << 8) | buf[p + 11];
        step = 12;
      }
      entries.push({ mediaTime: mediaTime, rateInt: rateInt, rateFrac: rateFrac });
      p += step;
    }
    var nonempty = [];
    for (var j = 0; j < entries.length; j++) if (entries[j].mediaTime !== -1) nonempty.push(entries[j]);
    if (!nonempty.length && !entries.length) return { ok: true, mediaTime: 0 };
    if (nonempty.length !== 1) return { ok: false };
    if (nonempty[0].rateInt !== 1 || nonempty[0].rateFrac !== 0) return { ok: false };
    return { ok: true, mediaTime: nonempty[0].mediaTime };
  }
  function parseTrak(buf, trak) {
    var tkhd = child(buf, trak, 'tkhd');
    var mdia = child(buf, trak, 'mdia');
    var mdhd = child(buf, mdia, 'mdhd');
    var hdlr = child(buf, mdia, 'hdlr');
    var minf = child(buf, mdia, 'minf');
    var stbl = child(buf, minf, 'stbl');
    var stsd = child(buf, stbl, 'stsd');
    if (!tkhd || !mdhd || !hdlr) return null;
    var ver = buf[tkhd.payload];
    var trackId = u32(buf, tkhd.payload + (ver === 1 ? 16 : 12));
    var handler = fourcc(buf, hdlr.payload + 8);
    var mdv = buf[mdhd.payload];
    var timescale = u32(buf, mdhd.payload + (mdv === 1 ? 20 : 12));
    var edit = parseElst(buf, trak);
    return { id: trackId, handler: handler, timescale: timescale, entries: parseStsd(buf, stsd), edit: edit };
  }
  function parseMoov(bus, st, buf) {
    var boxes = children(buf, 0, buf.length);
    var trex = new Map();
    for (var i = 0; i < boxes.length; i++) {
      if (boxes[i].type !== 'mvex') continue;
      var kids = children(buf, boxes[i].payload, boxes[i].end);
      for (var k = 0; k < kids.length; k++) {
        if (kids[k].type !== 'trex') continue;
        var p = kids[k].payload;
        trex.set(u32(buf, p + 4), {
          desc: u32(buf, p + 8), dur: u32(buf, p + 12), size: u32(buf, p + 16), flags: u32(buf, p + 20),
        });
      }
    }
    var tracks = [];
    var vide = 0;
    var timingBad = false;
    for (var t = 0; t < boxes.length; t++) {
      if (boxes[t].type !== 'trak') continue;
      var tr = parseTrak(buf, boxes[t]);
      if (!tr) continue;
      tracks.push(tr);
      if (tr.handler === 'vide') {
        vide++;
        if (!tr.edit.ok) timingBad = true;
      }
    }
    st.tracks = tracks;
    st.trex = trex;
    st.vide = vide;
    st.moovSeen = true;
    if (st.joinedLate) {
      st.joinedLate = false;
      bus.emit({ t: 'st', why: 'joined-clear', ms: st.ms, sb: st.sb });
      st.sent.joined = false;
    }
    var described = [];
    for (var a = 0; a < tracks.length; a++) {
      if (tracks[a].handler !== 'vide') continue;
      var e0 = tracks[a].entries[0] || { codec: '', w: 0, h: 0 };
      described.push({ id: tracks[a].id, codec: e0.codec, w: e0.w, h: e0.h });
    }
    st.pendingInits.push({ t: 'init', ms: st.ms, sb: st.sb, vide: vide, tracks: described });
    if (timingBad) status(bus, st, 'timing');
    var total = 0;
    for (var q = 0; q < bus.parsers.length; q++) {
      if (bus.parsers[q].ms === st.ms && !bus.parsers[q].dead) total += bus.parsers[q].vide || 0;
    }
    if (total > 1) status(bus, st, 'several');
  }

  function trackById(st, id) {
    for (var i = 0; i < st.tracks.length; i++) if (st.tracks[i].id === id) return st.tracks[i];
    return null;
  }
  function addArrived(st, a, b) {
    if (!(b > a)) return;
    st.arrived.push([a, b]);
    st.arrived.sort(function (x, y) { return x[0] - y[0]; });
    var out = [];
    for (var i = 0; i < st.arrived.length; i++) {
      var cur = st.arrived[i];
      if (!out.length || cur[0] > out[out.length - 1][1]) out.push(cur);
      else if (cur[1] > out[out.length - 1][1]) out[out.length - 1][1] = cur[1];
    }
    st.arrived = out;
  }
  function rangeCovered(st, a, b) {
    if (!(b > a)) return true;
    var x = a;
    for (var i = 0; i < st.arrived.length; i++) {
      var r = st.arrived[i];
      if (r[1] <= x) continue;
      if (r[0] > x) return false;
      x = r[1];
      if (x >= b) return true;
    }
    return x >= b;
  }
  function releaseCovered(st) {
    if (!st.waiters.length) return;
    var stay = [];
    for (var i = 0; i < st.waiters.length; i++) {
      var w = st.waiters[i];
      var ok = true;
      var ranges = w.ranges || [];
      for (var s = 0; s < ranges.length; s++) {
        if (!rangeCovered(st, ranges[s][0], ranges[s][1])) { ok = false; break; }
      }
      if (ok) { w.mdatDone = true; st.ready.push(w); }
      else stay.push(w);
    }
    st.waiters = stay;
  }
  function parseMoof(bus, st, buf) {
    if (!st.moovSeen || st.joinedLate) return;
    var boxes = children(buf, 0, buf.length);
    var samples = [];
    var ranges = [];
    var meta = null;
    var unknownKey = false;
    var timingBad = false;
    for (var i = 0; i < boxes.length; i++) {
      if (boxes[i].type !== 'traf') continue;
      var kids = children(buf, boxes[i].payload, boxes[i].end);
      var tfhd = null, tfdt = null, truns = [];
      for (var k = 0; k < kids.length; k++) {
        if (kids[k].type === 'tfhd') tfhd = kids[k];
        else if (kids[k].type === 'tfdt') tfdt = kids[k];
        else if (kids[k].type === 'trun') truns.push(kids[k]);
      }
      if (!tfhd) continue;
      var flags = u32(buf, tfhd.payload) & 0xffffff;
      var p = tfhd.payload + 4;
      var trackId = u32(buf, p); p += 4;
      // Sample bytes are moof-base + trun data_offset + earlier sizes in that run.
      // Flag 0x1 is an absolute base. Flag 0x020000 means the base is the moof box.
      var baseFile = st.pos;
      if (flags & 1) { baseFile = u64(buf, p); p += 8; }
      else if (flags & 0x020000) baseFile = st.moofAt;
      var desc = null, defDur = null, defSize = null, defFlags = null;
      if (flags & 2) { desc = u32(buf, p); p += 4; }
      if (flags & 8) { defDur = u32(buf, p); p += 4; }
      if (flags & 16) { defSize = u32(buf, p); p += 4; }
      if (flags & 32) { defFlags = u32(buf, p); p += 4; }
      var tr = trackById(st, trackId);
      var tx = st.trex.get(trackId);
      if (!tr || tr.handler !== 'vide') continue;
      if (!tr.edit.ok) { timingBad = true; continue; }
      var idx = desc != null ? desc : tx ? tx.desc : 1;
      if (!(idx >= 1)) idx = 1;
      var entry = tr.entries[idx - 1] || tr.entries[0] || { codec: '', w: 0, h: 0 };
      meta = { track: trackId, cfg: { w: entry.w, h: entry.h, codec: entry.codec }, timescale: tr.timescale, mediaTime: tr.edit.mediaTime };
      var base = 0;
      if (tfdt) {
        var tv = buf[tfdt.payload];
        base = tv === 1 ? u64(buf, tfdt.payload + 4) : u32(buf, tfdt.payload + 4);
      }
      var dts = base;
      var emptyDur = !!(flags & 0x010000);
      for (var r = 0; r < truns.length; r++) {
        var tb = truns[r];
        var vf = u32(buf, tb.payload);
        var version = vf >>> 24;
        var f = vf & 0xffffff;
        var q = tb.payload + 4;
        var count = u32(buf, q); q += 4;
        // The cap is the whole append, across every trun, and it is checked before the loop.
        if ((st.appendCount || 0) + count > SAMPLE_CAP) { bus.halt('safety'); return; }
        st.appendCount += count;
        var dataOff = 0;
        if (f & 1) { dataOff = i32(buf, q); q += 4; }
        var byteAt = baseFile + dataOff;
        var firstFlags = null;
        if (f & 4) { firstFlags = u32(buf, q); q += 4; }
        var sb = (f & 0x100 ? 4 : 0) + (f & 0x200 ? 4 : 0) + (f & 0x400 ? 4 : 0) + (f & 0x800 ? 4 : 0);
        if (q + count * sb > tb.end) { st.dead = true; status(bus, st, 'unparsed'); return; }
        for (var n = 0; n < count; n++) {
          var dur = defDur != null ? defDur : tx ? tx.dur : 0;
          var size = defSize != null ? defSize : tx ? tx.size : 0;
          var sampleFlags = null;
          if (f & 0x100) { dur = u32(buf, q); q += 4; }
          if (f & 0x200) { size = u32(buf, q); q += 4; }
          if (f & 0x400) { sampleFlags = u32(buf, q); q += 4; }
          var cto = 0;
          if (f & 0x800) { cto = version === 1 ? i32(buf, q) : u32(buf, q); q += 4; }
          var sf = n === 0 && firstFlags != null ? firstFlags : sampleFlags != null ? sampleFlags : defFlags != null ? defFlags : tx ? tx.flags : null;
          if (emptyDur) dur = 0;
          var key = sf == null ? null : (sf & 0x10000) ? 0 : 1;
          if (key == null) unknownKey = true;
          var pts = dts + cto - tr.edit.mediaTime;
          dts += dur;
          var b0 = byteAt;
          byteAt += size;
          if (unknownKey || timingBad || bus.stopped) continue;
          var sec0 = pts / tr.timescale + st.win.offset;
          var sec1 = (pts + dur) / tr.timescale + st.win.offset;
          // The browser keeps a sample only when its whole interval sits inside the append window.
          if (sec0 < st.win.w0 || sec1 > st.win.w1) { st.needRap = true; continue; }
          if (st.needRap) {
            if (key !== 1) continue;
            st.needRap = false;
          }
          samples.push([pts, dur, size, key]);
          ranges.push([b0, b0 + (size > 0 ? size : 0)]);
        }
      }
    }
    if (bus.stopped) return;
    if (timingBad) { status(bus, st, 'timing'); return; }
    if (unknownKey) { status(bus, st, 'keyframes'); return; }
    if (!meta || !samples.length) return;
    st.waiters.push({
      mdatDone: false,
      ranges: ranges,
      rec: {
        t: 'f', ms: st.ms, sb: st.sb, track: meta.track, cfg: meta.cfg,
        samples: samples, timescale: meta.timescale, offset: st.win.offset,
      },
    });
  }

  function finishBox(bus, st) {
    var type = st.boxType;
    var payload = st.copy;
    var mdatFrom = st.mdatAt;
    var mdatTo = st.pos;
    st.phase = 'hdr'; st.kind = ''; st.copy = null; st.filled = 0; st.left = 0; st.size0 = false; st.boxType = '';
    if (st.dead || bus.stopped) return;
    if (type === 'moov') parseMoov(bus, st, payload);
    else if (type === 'moof') { parseMoof(bus, st, payload); if (!bus.stopped) releaseCovered(st); }
    else if (type === 'mdat') { addArrived(st, mdatFrom, mdatTo); if (!bus.stopped) releaseCovered(st); }
  }
  function openBox(bus, st) {
    var b = st.hdr;
    var size32 = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
    if (!st.sawAny) {
      st.sawAny = true;
      if (!ascii(b, 4) || (size32 !== 0 && size32 !== 1 && size32 < 8)) {
        st.dead = true; status(bus, st, 'unparsed'); return false;
      }
    }
    if (!ascii(b, 4)) { st.dead = true; status(bus, st, 'unparsed'); return false; }
    if (size32 === 1 && st.hdrNeed < 16) { st.hdrNeed = 16; return true; }
    var headerLen = 8;
    var total = size32;
    if (size32 === 1) {
      headerLen = 16;
      total = u64(b, 8);
      if (!(total >= 16)) { st.dead = true; status(bus, st, 'unparsed'); return false; }
    } else if (size32 !== 0 && size32 < 8) { st.dead = true; status(bus, st, 'unparsed'); return false; }
    var payload = total === 0 ? Infinity : total - headerLen;
    var type = fourcc(b, 4);
    st.hdr = []; st.hdrNeed = 8; st.boxType = type; st.phase = 'body'; st.left = payload; st.size0 = total === 0;
    st.boxStart = st.pos - headerLen;
    if (type === 'moof') st.moofAt = st.boxStart;
    if (type === 'mdat') st.mdatAt = st.pos;
    if (type === 'moov' || type === 'moof') {
      if (!(payload > 0) || payload === Infinity || payload > CAP) { bus.halt('safety'); st.dead = true; return false; }
      st.kind = 'copy'; st.copy = new Uint8Array(payload); st.filled = 0;
    } else if (type === 'mdat') st.kind = 'mdat';
    else st.kind = 'skip';
    return true;
  }
  function feed(bus, st, bytes) {
    if (st.dead || bus.stopped) return;
    st.appendCount = 0;
    var i = 0;
    var n = bytes.length;
    while (i < n && !st.dead && !bus.stopped) {
      if (st.phase === 'hdr') {
        var take = Math.min(st.hdrNeed - st.hdr.length, n - i);
        for (var k = 0; k < take; k++) st.hdr.push(bytes[i++]);
        st.pos += take;
        if (st.hdr.length < st.hdrNeed) break;
        if (!openBox(bus, st)) return;
        continue;
      }
      var room = n - i;
      var use = st.left === Infinity ? room : Math.min(st.left, room);
      if (use < 0) use = 0;
      if (st.kind === 'copy' && use) { st.copy.set(bytes.subarray(i, i + use), st.filled); st.filled += use; }
      i += use;
      st.pos += use;
      if (st.left !== Infinity) {
        st.left -= use;
        if (st.left === 0) finishBox(bus, st);
      }
    }
    if (!st.dead && !bus.stopped && st.phase === 'body' && st.left === Infinity) finishBox(bus, st);
    if (!st.firstDecided && st.phase === 'hdr' && st.hdr.length === 0) {
      st.firstDecided = true;
      if (!st.moovSeen) { st.joinedLate = true; status(bus, st, 'joined'); }
    }
  }
  function takeReady(bus, st) {
    var out = st.pendingInits.splice(0, st.pendingInits.length);
    var ready = st.ready.splice(0, st.ready.length);
    for (var i = 0; i < ready.length; i++) if (ready[i].mdatDone) out.push(ready[i].rec);
    for (var j = 0; j < out.length; j++) {
      if (out[j].t === 'init') {
        if (!bus.pinned.has(st.sb) && bus.pinned.size >= PIN_CAP) { bus.halt('safety'); return; }
        bus.pinned.set(st.sb, out[j]);
      }
      bus.emit(out[j]);
    }
  }

  function makeTest() {
    var bus = createBus();
    var st = newParser('ms', 'sb');
    bus.parsers.push(st);
    var got = [];
    bus.sink = function (rec) { got.push(rec); };
    return {
      feed: function (bytes, opts) {
        opts = opts || {};
        var before = got.length;
        if (bus.stopped) return { records: [], stopped: bus.stopped };
        if (opts.abort) {
          resetPartial(st); st.needRap = true; st.inflight = null;
          return { records: [], stopped: bus.stopped };
        }
        st.win = { offset: opts.offset || 0, w0: opts.w0 || 0, w1: opts.w1 == null ? Infinity : opts.w1 };
        if (opts.mode === 'sequence') { status(bus, st, 'sequence'); return { records: got.slice(before), stopped: bus.stopped }; }
        var snap = snapOf(st);
        var t0 = g.performance && g.performance.now ? g.performance.now() : 0;
        try { feed(bus, st, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)); }
        catch (e) { restore(st, snap); }
        var dt = (g.performance && g.performance.now ? g.performance.now() : 0) - t0;
        bus.noteTime(dt);
        if (opts.fail || bus.over(dt)) {
          restore(st, snap);
          if (bus.over(dt)) bus.halt('killed');
        } else takeReady(bus, st);
        return { records: got.slice(before), stopped: bus.stopped, times: bus.parseTimes.slice() };
      },
    };
  }

  // Queues records, then sizes, encodes and sends them in a later task, never inside the player's call.
  // The replay keeps the newest encoded records within both caps; a late HUD shows any older gap as missing coverage.
  function createTransport(bus, timers, send) {
    var pending = [], timer = 0, replay = [], replaySeq = [], replayBytes = 0;
    function encode(rec) {
      try { return JSON.stringify(rec); } catch (e) { return ''; }
    }
    function deliver(parts) {
      var list = [];
      for (var i = 0; i < parts.length; i++) if (parts[i]) list.push(parts[i]);
      if (list.length) send('{"session":' + JSON.stringify(bus.session) + ',"records":[' + list.join(',') + ']}');
    }
    function flush() {
      timer = 0;
      var records = pending;
      pending = [];
      var parts = [], total = 0;
      for (var i = 0; i < records.length; i++) {
        var str = encode(records[i]);
        parts.push(str);
        total += str.length;
      }
      if (!bus.stopped && total > QUEUE_BYTES) { bus.halt('safety'); return; }
      for (var j = 0; j < records.length; j++) {
        if (!parts[j]) continue;
        replay.push(parts[j]);
        replaySeq.push(records[j].seq);
        replayBytes += parts[j].length;
      }
      while (replay.length && (replay.length > QUEUE_CAP || replayBytes > QUEUE_BYTES)) {
        replayBytes -= replay.shift().length;
        replaySeq.shift();
      }
      deliver(parts);
    }
    return {
      sink: function (rec) {
        if (bus.stopped && !(rec.t === 'st' && rec.why === bus.stopped)) return;
        if (!bus.stopped && pending.length >= QUEUE_CAP) { bus.halt('safety'); return; }
        pending.push(rec);
        if (!timer) timer = timers.setTimeout(flush, 0) || 1;
      },
      replay: function () {
        var items = [];
        bus.pinned.forEach(function (rec) { items.push({ seq: rec.seq, str: encode(rec) }); });
        for (var i = 0; i < replay.length; i++) items.push({ seq: replaySeq[i], str: replay[i] });
        items.sort(function (a, b) { return a.seq - b.seq; });
        deliver(items.map(function (it) { return it.str; }));
      },
      bytes: function () { return replayBytes; },
    };
  }

  if (g && g.SQH_READER_TEST) {
    g.SQH_READER_API = makeTest();
    g.SQH_READER_API.createBus = createBus;
    g.SQH_READER_API.createTransport = createTransport;
    return;
  }
  if (!g || !g.document || !g.window) return;
  var MARK = Symbol.for('sqh.reader');
  try {
    if (g[MARK]) return;
    Object.defineProperty(g, MARK, { value: true, configurable: false, enumerable: false, writable: false });
  } catch (e) { return; }

  var bus = createBus();
  var bySb = new WeakMap();
  var msIds = new WeakMap();
  var sbIds = new WeakMap();
  var blobs = new Map();
  var msN = 0, sbN = 0;
  var releasedMs = new Set();
  function msId(ms) {
    var id = msIds.get(ms);
    if (!id) { id = 'ms' + (++msN); msIds.set(ms, id); }
    return id;
  }
  function sbId(sb) {
    var id = sbIds.get(sb);
    if (!id) { id = 'sb' + (++sbN); sbIds.set(sb, id); }
    return id;
  }
  var transport = createTransport(bus, g, function (detail) {
    try { g.document.dispatchEvent(new g.CustomEvent('sqh:pieces', { detail: detail })); } catch (e) {}
  });
  bus.sink = transport.sink;
  function isMS(o) {
    if (!o || typeof o !== 'object') return false;
    try { if (typeof g.MediaSource !== 'undefined' && o instanceof g.MediaSource) return true; } catch (e) {}
    try { if (typeof g.ManagedMediaSource !== 'undefined' && o instanceof g.ManagedMediaSource) return true; } catch (e) {}
    return false;
  }
  function isHandle(o) {
    if (!o || typeof o !== 'object') return false;
    try { if (typeof g.MediaSourceHandle !== 'undefined' && o instanceof g.MediaSourceHandle) return true; } catch (e) {}
    var n = o.constructor && o.constructor.name;
    return n === 'MediaSourceHandle';
  }
  function ownerOf(video) {
    try {
      var so = video.srcObject;
      if (isMS(so)) return msId(so);
      if (isHandle(so)) return 'worker';
    } catch (e) {}
    try {
      var u = video.currentSrc || video.src || '';
      if (u && blobs.has(u)) return blobs.get(u);
    } catch (e2) {}
    return 'none';
  }
  function bytesOf(buf) {
    try {
      if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
      if (ArrayBuffer.isView(buf)) return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } catch (e) {}
    return null;
  }
  function parserFor(sb) {
    var st = bySb.get(sb);
    if (st) return st;
    var ms = '';
    try { if (sb && isMS(sb.mediaSource || sb.source || null)) ms = msId(sb.mediaSource || sb.source); } catch (e) {}
    st = newParser(ms, sbId(sb));
    bySb.set(sb, st);
    bus.parsers.push(st);
    return st;
  }
  function bindSb(ms, sb) {
    var st = parserFor(sb);
    st.ms = msId(ms);
    if (st.listening) return;
    st.listening = true;
    sb.addEventListener('error', function () { st.failed = true; });
    sb.addEventListener('updateend', function () {
      try {
        if (st.pendingRemove) {
          var pr = st.pendingRemove;
          st.pendingRemove = null;
          if (st.failed || bus.stopped) { st.failed = false; return; }
          var gaps = subtractRanges(pr.before, rangesOf(sb));
          if (gaps.length) {
            for (var gi = 0; gi < gaps.length; gi++) st.pendingInits.push({ t: 'rm', ms: st.ms, sb: st.sb, start: gaps[gi][0], end: gaps[gi][1] });
          } else if (!pr.before.length && typeof pr.start === 'number' && typeof pr.end === 'number') {
            st.pendingInits.push({ t: 'rm', ms: st.ms, sb: st.sb, start: pr.start, end: pr.end });
          }
          takeReady(bus, st);
          return;
        }
        if (!st.inflight) return;
        if (st.failed) { restore(st, st.inflight); st.failed = false; st.inflight = null; return; }
        takeReady(bus, st);
        st.inflight = null;
      } catch (e) { st.inflight = null; st.pendingRemove = null; }
    });
  }
  function rangesOf(sb) {
    var out = [];
    try {
      var b = sb.buffered;
      if (!b || typeof b.length !== 'number') return out;
      for (var i = 0; i < b.length; i++) out.push([b.start(i), b.end(i)]);
    } catch (e) {}
    return out;
  }
  function subtractRanges(before, after) {
    var gaps = [];
    for (var i = 0; i < before.length; i++) {
      var cuts = [[before[i][0], before[i][1]]];
      for (var j = 0; j < after.length && cuts.length; j++) {
        var c = after[j][0], d = after[j][1];
        var next = [];
        for (var k = 0; k < cuts.length; k++) {
          var s = cuts[k][0], e = cuts[k][1];
          if (!(d > s && c < e)) { next.push([s, e]); continue; }
          if (c > s) next.push([s, c]);
          if (d < e) next.push([d, e]);
        }
        cuts = next;
      }
      for (var n = 0; n < cuts.length; n++) if (cuts[n][1] > cuts[n][0]) gaps.push(cuts[n]);
    }
    return gaps;
  }
  function pageSeam() {
    // A normal read does not call a getter that was defined on this realm's global
    // from outside it. The descriptor does, so a throwing page-owned getter stops
    // the wrapper before the native append.
    var sym = Symbol.for('sqh.throwAppend');
    var desc = Object.getOwnPropertyDescriptor(g, sym);
    if (desc && typeof desc.get === 'function') return desc.get.call(g);
    if (desc) return desc.value;
    return g[sym];
  }
  function onAppend(sb, orig, args) {
    var seam = pageSeam();
    if (seam) throw seam;
    var st = null;
    var snap = null;
    try {
      st = bySb.get(sb) || parserFor(sb);
      if (!bus.stopped && st && !st.dead) {
        var mode = 'segments';
        try { mode = sb.mode; } catch (e) {}
        var offset = 0, w0 = 0, w1 = Infinity;
        try { offset = sb.timestampOffset || 0; w0 = sb.appendWindowStart || 0; w1 = sb.appendWindowEnd; } catch (e2) {}
        if (!(w1 > w0)) w1 = Infinity;
        st.win = { offset: offset, w0: w0, w1: w1 };
        if (mode === 'sequence') status(bus, st, 'sequence');
        else {
          snap = snapOf(st);
          st.inflight = snap;
          var bytes = bytesOf(args[0]);
          var t0 = g.performance.now();
          if (bytes) feed(bus, st, bytes);
          var dt = g.performance.now() - t0;
          bus.noteTime(dt);
          if (bus.over(dt)) { restore(st, snap); st.inflight = null; bus.halt('killed'); }
        }
      }
    } catch (e3) {
      if (st && snap) { restore(st, snap); st.inflight = null; }
    }
    try { return orig.apply(sb, args); }
    catch (err) {
      if (st && snap) { restore(st, snap); st.inflight = null; }
      throw err;
    }
  }
  function onRemove(sb, orig, args) {
    var st = null;
    var before = null;
    var numStart = null;
    var numEnd = null;
    try {
      st = bySb.get(sb);
      if (st && !bus.stopped) {
        before = rangesOf(sb);
        // typeof does not call valueOf, so an object start reaches the browser once.
        if (typeof args[0] === 'number') numStart = args[0];
        if (typeof args[1] === 'number') numEnd = args[1];
      }
    } catch (e) {}
    var result = orig.apply(sb, args);
    try {
      if (st && before && !bus.stopped) st.pendingRemove = { before: before, start: numStart, end: numEnd };
    } catch (e2) {}
    return result;
  }
  function onAbort(sb, orig, args) {
    try {
      var st = bySb.get(sb);
      if (st) { st.inflight = null; st.failed = false; st.pendingRemove = null; resetPartial(st); st.needRap = true; }
    } catch (e) {}
    return orig.apply(sb, args);
  }
  function wrap(proto, name, impl) {
    if (!proto) return;
    var orig = proto[name];
    if (typeof orig !== 'function' || orig[MARK]) return;
    function wrapped() {
      try { return impl(this, orig, arguments); }
      catch (err) { throw err; }
    }
    try { wrapped[MARK] = true; } catch (e) {}
    proto[name] = wrapped;
  }
  function own(proto, name) {
    return !!(proto && Object.prototype.hasOwnProperty.call(proto, name));
  }
  function dropMs(id) {
    if (!id || releasedMs.has(id)) return;
    releasedMs.add(id);
    var keep = [];
    for (var i = 0; i < bus.parsers.length; i++) {
      var p = bus.parsers[i];
      if (p.ms !== id) { keep.push(p); continue; }
      p.dead = true;
      p.waiters = [];
      p.ready = [];
      p.pendingInits = [];
      p.tracks = [];
      p.vide = 0;
      p.inflight = null;
      p.pendingRemove = null;
      bus.pinned.delete(p.sb);
    }
    bus.parsers = keep;
    blobs.forEach(function (v, k) { if (v === id) blobs.delete(k); });
    try { bus.emit({ t: 'bye', ms: id, sb: '' }); } catch (err) {}
  }
  function watchMs(ms) {
    if (!ms || ms[MARK]) return;
    try { ms[MARK] = true; } catch (e) {}
    ms.addEventListener('sourceclose', function () {
      try { dropMs(msId(ms)); } catch (err) {}
    });
  }
  function onAdd(ms, orig, args) {
    var sb = orig.apply(ms, args);
    try { watchMs(ms); bindSb(ms, sb); } catch (e) {}
    return sb;
  }
  try {
    if (g.MediaSource && g.MediaSource.prototype) wrap(g.MediaSource.prototype, 'addSourceBuffer', onAdd);
    if (typeof g.ManagedMediaSource !== 'undefined' && g.ManagedMediaSource.prototype) wrap(g.ManagedMediaSource.prototype, 'addSourceBuffer', onAdd);
    if (g.SourceBuffer && g.SourceBuffer.prototype) {
      wrap(g.SourceBuffer.prototype, 'appendBuffer', onAppend);
      wrap(g.SourceBuffer.prototype, 'remove', onRemove);
      wrap(g.SourceBuffer.prototype, 'abort', onAbort);
    }
    if (typeof g.ManagedSourceBuffer !== 'undefined' && g.ManagedSourceBuffer.prototype) {
      var mp = g.ManagedSourceBuffer.prototype;
      if (own(mp, 'appendBuffer')) wrap(mp, 'appendBuffer', onAppend);
      if (own(mp, 'remove')) wrap(mp, 'remove', onRemove);
      if (own(mp, 'abort')) wrap(mp, 'abort', onAbort);
    }
  } catch (e) {}
  try {
    var create = g.URL && g.URL.createObjectURL;
    if (typeof create === 'function' && !create[MARK]) {
      function wrappedCreate(obj) {
        var url = create.apply(g.URL, arguments);
        try {
          if (isMS(obj)) {
            blobs.set(url, msId(obj));
            if (blobs.size > 256) blobs.delete(blobs.keys().next().value);
          }
        } catch (err) {}
        return url;
      }
      try { wrappedCreate[MARK] = true; } catch (e2) {}
      g.URL.createObjectURL = wrappedCreate;
    }
    var revoke = g.URL && g.URL.revokeObjectURL;
    if (typeof revoke === 'function' && !revoke[MARK]) {
      function wrappedRevoke(url) {
        try {
          // Revoking the address doesn't detach an attached MediaSource; it is released on sourceclose.
          void url;
        } catch (err) {}
        return revoke.apply(g.URL, arguments);
      }
      try { wrappedRevoke[MARK] = true; } catch (e2b) {}
      g.URL.revokeObjectURL = wrappedRevoke;
    }
  } catch (e3) {}
  try {
    var desc = Object.getOwnPropertyDescriptor(g.HTMLMediaElement.prototype, 'srcObject');
    if (desc && desc.set && !desc.set[MARK]) {
      function wrappedSet(v) {
        var prev = null;
        try { prev = this.srcObject; } catch (err0) {}
        try { if (isMS(v)) msId(v); } catch (err) {}
        var out = desc.set.call(this, v);
        try { if (isMS(prev) && prev !== v) dropMs(msId(prev)); } catch (err2) {}
        return out;
      }
      try { wrappedSet[MARK] = true; } catch (e4) {}
      Object.defineProperty(g.HTMLMediaElement.prototype, 'srcObject', {
        set: wrappedSet, get: desc.get, configurable: true, enumerable: desc.enumerable,
      });
    }
  } catch (e5) {}
  g.document.addEventListener('sqh:which', function (e) {
    var v = e.target;
    if (!v || !v.tagName || v.tagName !== 'VIDEO') return;
    var id = 'none';
    try { id = ownerOf(v); } catch (err) {}
    try { v.dispatchEvent(new g.CustomEvent('sqh:owner', { detail: String(id) })); } catch (err2) {}
  }, true);
  g.document.addEventListener('sqh:ping', function () {
    try {
      g.document.dispatchEvent(new g.CustomEvent('sqh:pong', { detail: JSON.stringify({ version: VERSION, session: bus.session }) }));
      transport.replay();
    } catch (err) {}
  });
  g.document.addEventListener('sqh:cost', function () {
    try {
      g.document.dispatchEvent(new g.CustomEvent('sqh:parse-cost', { detail: JSON.stringify(bus.parseTimes) }));
    } catch (err) {}
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
