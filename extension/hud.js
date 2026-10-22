// Stream Quality HUD: current picture, codec-adjusted data grades and plain-language sound.
// Supported playback issues appear in the overview; service/device possibilities and diagnostic
// measurements live under Technical details. It only reads; it never touches the sound.
// (Control+Option+Shift combinations never reach web pages on Andy's Mac, so the key avoids Option.)
//
// How it knows "the best version": the page's player downloads a quality list (a DASH .mpd or an
// HLS .m3u8 master playlist). This script notices those downloads in the page's resource timing,
// reads the same list with the page's own rights, and compares its sizes with the size the video
// element is decoding. A list only counts when the video's source, or a download the video made since
// its current source started loading, points to exactly one answer; otherwise the verdict is "can't
// tell". Sites without such a list (e.g. Netflix) get the screen comparison only.
(() => {
  'use strict';
  if (window.__streamQualityHud) return;
  window.__streamQualityHud = true;

  const VIDEO_CODEC = /^(avc[13]|hvc1|hev1|dvh1|dvhe|dva1|dvav|dav1|vp0?9|vp8|av01|vvc1|vvi1)/i;
  const AUDIO_CODEC = /^(mp4a|ac-3|ec-3|ac-4|opus|flac|alac|dts[a-z]|mhm1|mha1)/i;
  const MAX_MANIFESTS = 30;
  const MAX_RECENT = 600;
  const ladders = []; // newest last: { kind, url, part, variants: [{ w, h, bps, codecs, fps, range, exact, patterns, hls }], audio: [see audioEntry] }
  const seen = new Set();
  const recent = []; // { name: url without fragment, u: url without query, t } for every resource the page loads
  const sessionStart = new WeakMap(); // video -> time its current source started loading

  const strip = (u) => String(u || '').split(/[?#]/)[0];
  const noFrag = (u) => String(u || '').split('#')[0];
  function isManifestUrl(raw) {
    try {
      const u = new URL(raw);
      return /^https?:$/.test(u.protocol) && /\.(mpd|m3u8)$/i.test(u.pathname);
    } catch (e) {
      return false;
    }
  }

  // ---------- quality lists ----------

  function consider(url) {
    if (typeof url !== 'string' || seen.has(url) || seen.size >= MAX_MANIFESTS || !isManifestUrl(url)) return;
    seen.add(url);
    pageFetch(url)
      .then((text) => addLists(text, url))
      .catch(() => {});
  }

  // Same rights as the page itself: the request the player made, made again. A list the page
  // couldn't read either stays unread.
  async function pageFetch(url) {
    for (const credentials of ['include', 'same-origin']) {
      try {
        const r = await fetch(url, { credentials, cache: 'force-cache' });
        if (r.ok) return await r.text();
      } catch (e) {
        // CORS: try the next mode
      }
    }
    throw new Error('unreadable');
  }

  function addLists(text, url) {
    for (const ladder of parseManifest(text, url)) {
      ladders.push(ladder);
      if (ladders.length > 20) ladders.shift();
    }
  }

  function parseManifest(text, url) {
    if (typeof text !== 'string') return [];
    if (/<MPD[\s>]/.test(text)) return parseDash(text, url);
    if (/^\s*#EXTM3U/.test(text) && /^#EXT-X-STREAM-INF:/m.test(text)) return parseHls(text, url);
    return [];
  }

  const kids = (el, name) => (el ? [...el.children].filter((c) => c.localName === name) : []);
  function baseOf(base, el) {
    const b = kids(el, 'BaseURL')[0];
    if (!b) return base;
    try {
      return new URL(b.textContent.trim(), base).href;
    } catch (e) {
      return base;
    }
  }
  const isTrickMode = (el) =>
    kids(el, 'EssentialProperty').concat(kids(el, 'SupplementalProperty')).some((p) => /trickmode/i.test(p.getAttribute('schemeIdUri') || ''));

  // Each DASH Period is its own list: periods are different stretches of time (the feature, an ad break),
  // not alternative qualities of the same picture.
  function parseDash(text, url) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) return [];
    const mpd = doc.documentElement;
    const periods = kids(mpd, 'Period');
    const mpdBase = baseOf(url, mpd);
    const out = [];
    periods.forEach((period, i) => {
      const pBase = baseOf(mpdBase, period);
      const variants = [];
      const audio = [];
      const keys = new Set();
      for (const set of kids(period, 'AdaptationSet')) {
        if (isTrickMode(set)) continue;
        const sBase = baseOf(pBase, set);
        for (const rep of kids(set, 'Representation')) {
          const attr = (n) => rep.getAttribute(n) || set.getAttribute(n) || '';
          if (isTrickMode(rep) || parseFloat(attr('maxPlayoutRate')) > 1) continue;
          const type = set.getAttribute('contentType') || '';
          const mime = attr('mimeType');
          const codecs = attr('codecs');
          if ((type === 'audio' || /^audio\//i.test(mime) || AUDIO_CODEC.test(codecs)) && !VIDEO_CODEC.test(codecs)) {
            const tpl = kids(rep, 'SegmentTemplate')[0] || kids(set, 'SegmentTemplate')[0] || kids(period, 'SegmentTemplate')[0];
            const list = kids(rep, 'SegmentList')[0] || kids(set, 'SegmentList')[0] || kids(period, 'SegmentList')[0];
            const props = [rep, set].flatMap((el) => kids(el, 'SupplementalProperty').concat(kids(el, 'EssentialProperty')));
            const roles = [rep, set].flatMap((el) => kids(el, 'Role').concat(kids(el, 'Accessibility'))).map((r) => (r.getAttribute('value') || '').toLowerCase());
            audio.push(
              audioEntry({
                codecs,
                bps: parseInt(attr('bandwidth'), 10) || 0,
                rate: parseInt(attr('audioSamplingRate'), 10) || 0,
                ch: dashChannels(kids(rep, 'AudioChannelConfiguration')[0] || kids(set, 'AudioChannelConfiguration')[0]),
                joc: props.some((p) => /EC3_ExtensionType/i.test(p.getAttribute('schemeIdUri') || '') && /JOC/i.test(p.getAttribute('value') || '')),
                lang: attr('lang'),
                extra: roles.some((r) => /description|commentary|dub|enhanced-audio-intelligibility/.test(r)),
                ...dashMatchers(baseOf(sBase, rep), tpl, list, rep, url),
              })
            );
            continue;
          }
          const isVideo = (type === 'video' || /^video\//i.test(mime) || VIDEO_CODEC.test(codecs)) && !/^image/i.test(type) && !/^image\//i.test(mime);
          const w = parseInt(attr('width'), 10);
          const h = parseInt(attr('height'), 10);
          if (!isVideo || !(w > 0) || !(h > 0)) continue;
          const tpl = kids(rep, 'SegmentTemplate')[0] || kids(set, 'SegmentTemplate')[0] || kids(period, 'SegmentTemplate')[0];
          const list = kids(rep, 'SegmentList')[0] || kids(set, 'SegmentList')[0] || kids(period, 'SegmentList')[0];
          const v = {
            w,
            h,
            bps: parseInt(attr('bandwidth'), 10) || 0,
            codecs,
            fps: frameRate(attr('frameRate')),
            range: dashRange(rep, set, codecs),
            mime,
            ...dashMatchers(baseOf(sBase, rep), tpl, list, rep, url),
          };
          const key = [v.w, v.h, v.bps, v.codecs, v.range].join('|');
          if (!keys.has(key)) {
            keys.add(key);
            variants.push(v);
          }
        }
      }
      if (variants.length) out.push({ kind: 'DASH', url, part: periods.length > 1 ? period.getAttribute('id') || 'part ' + (i + 1) : '', variants, audio });
    });
    return out;
  }

  // The exact files, or complete file-name patterns, this representation's downloads use, so the
  // page's own requests can show which list the video is playing from.
  function dashMatchers(repBase, tpl, list, rep, manifestUrl) {
    const own = strip(manifestUrl);
    const dir = own.slice(0, own.lastIndexOf('/') + 1);
    const exact = new Set();
    const patterns = [];
    const addExact = (rel) => {
      try {
        const p = strip(new URL(rel, repBase).href);
        if (p !== own && p !== dir) exact.add(p);
      } catch (e) {}
    };
    if (tpl) {
      for (const a of ['media', 'initialization']) {
        const t = tpl.getAttribute(a);
        if (!t) continue;
        const marked = t
          .replace(/\$\$/g, '\u0001')
          .replace(/\$RepresentationID\$/g, rep.getAttribute('id') || '')
          .replace(/\$Bandwidth\$/g, rep.getAttribute('bandwidth') || '')
          .replace(/\$(Number|Time|SubNumber)(%0\d+d)?\$/g, 'SQHUDNUM9');
        if (marked.includes('$')) continue; // an identifier this script doesn't know
        let abs;
        try {
          abs = noFrag(new URL(marked.replace(/\u0001/g, '$'), repBase).href);
        } catch (e) {
          continue;
        }
        const withQuery = marked.includes('?');
        const body = (withQuery ? abs : strip(abs)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/SQHUDNUM9/g, '\\d+');
        if (body.includes('\\d+')) patterns.push({ rx: new RegExp('^' + body + '$'), withQuery });
        else addExact(abs);
      }
    } else if (list) {
      for (const el of kids(list, 'Initialization')) if (el.getAttribute('sourceURL')) addExact(el.getAttribute('sourceURL'));
      for (const el of kids(list, 'SegmentURL').slice(0, 400)) addExact(el.getAttribute('media') || '');
    } else {
      addExact('');
    }
    return { exact, patterns };
  }

  function dashRange(rep, set, codecs) {
    if (/^(dvh1|dvhe|dva1|dvav|dav1)/i.test(codecs)) return 'Dolby Vision';
    for (const el of [rep, set]) {
      for (const p of kids(el, 'SupplementalProperty').concat(kids(el, 'EssentialProperty'))) {
        if (!/TransferCharacteristics/i.test(p.getAttribute('schemeIdUri') || '')) continue;
        const val = p.getAttribute('value');
        if (val === '16') return 'HDR10';
        if (val === '18') return 'HLG';
      }
    }
    return '';
  }

  const hlsAttrs = (line) => {
    const a = {};
    line.replace(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g, (_, k, v) => {
      a[k] = v.replace(/^"|"$/g, '');
    });
    return a;
  };

  function parseHls(text, url) {
    const variants = [];
    const groupCodecs = {}; // audio GROUP-ID -> the audio codecs the variants that use it list
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
      const a = hlsAttrs(lines[i].slice(18));
      const audioCodecs = (a.CODECS || '').split(',').map((s) => s.trim()).filter((c) => AUDIO_CODEC.test(c));
      const g = a.AUDIO || '';
      groupCodecs[g] = uniq((groupCodecs[g] || []).concat(audioCodecs));
      let uri = '';
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j].trim();
        if (!l || (l.startsWith('#') && !l.startsWith('#EXT-X-STREAM-INF'))) continue;
        if (!l.startsWith('#')) uri = l;
        break;
      }
      const res = /^(\d+)x(\d+)$/.exec(a.RESOLUTION || '');
      if (!res) continue;
      const codecs = (a.CODECS || '').split(',').map((s) => s.trim()).find((c) => VIDEO_CODEC.test(c)) || '';
      let range = '';
      if (/^(dvh1|dvhe|dva1|dvav|dav1)/i.test(codecs)) range = 'Dolby Vision';
      else if (a['VIDEO-RANGE'] === 'PQ') range = 'HDR10';
      else if (a['VIDEO-RANGE'] === 'HLG') range = 'HLG';
      const exact = new Set();
      try {
        if (uri) exact.add(noFrag(new URL(uri, url).href)); // query kept: it often names the asset
      } catch (e) {}
      variants.push({ w: +res[1], h: +res[2], bps: +(a['AVERAGE-BANDWIDTH'] || a.BANDWIDTH) || 0, peak: !a['AVERAGE-BANDWIDTH'], codecs, fps: +a['FRAME-RATE'] || 0, range, exact, patterns: [], hls: true });
    }
    // Sound: separate audio renditions when the list has them, else the audio codecs muxed into the variants.
    const audio = [];
    for (const line of lines) {
      if (!line.startsWith('#EXT-X-MEDIA:')) continue;
      const a = hlsAttrs(line.slice(13));
      if (a.TYPE !== 'AUDIO') continue;
      const chm = /^(\d+)(\/JOC)?/i.exec(a.CHANNELS || '');
      const exact = new Set();
      try {
        if (a.URI) exact.add(noFrag(new URL(a.URI, url).href));
      } catch (e) {}
      const cs = groupCodecs[a['GROUP-ID'] || ''] || [];
      for (const codecs of cs.length ? cs : ['']) {
        audio.push(
          audioEntry({
            codecs,
            ch: chm && !chm[2] ? channelsOf(+chm[1]) : null,
            joc: !!(chm && chm[2]),
            lang: a.LANGUAGE || '',
            label: a.NAME || '',
            extra: /describes-video|describes-music/i.test(a.CHARACTERISTICS || ''),
            exact,
            patterns: [],
            hls: true,
          })
        );
      }
    }
    if (!audio.length) for (const codecs of uniq(Object.values(groupCodecs).flat())) audio.push(audioEntry({ codecs, exact: new Set(), patterns: [], hls: true }));
    return variants.length ? [{ kind: 'HLS', url, part: '', variants, audio }] : [];
  }

  function frameRate(s) {
    if (!s) return 0;
    const [n, d] = s.split('/').map(Number);
    return d ? n / d : n || 0;
  }

  const matches = (v, e) => (v.hls ? v.exact.has(e.name) : v.exact.has(e.u)) || v.patterns.some((p) => p.rx.test(p.withQuery ? e.name : e.u));

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!/^https?:/i.test(entry.name)) continue;
        consider(entry.name);
        recent.push({ name: noFrag(entry.name), u: strip(entry.name), t: entry.startTime });
        if (recent.length > MAX_RECENT) recent.shift();
      }
    }).observe({ type: 'resource', buffered: true });
  } catch (e) {
    // no resource timing: screen comparison only
  }

  // Downloads made before a video's current source started loading (a trailer, an earlier episode)
  // are never evidence for what it plays now.
  const markSession = (e) => {
    if (e.target && e.target.localName === 'video') sessionStart.set(e.target, e.timeStamp);
  };
  document.addEventListener('loadstart', markSession, true);
  document.addEventListener('emptied', markSession, true);

  // ---------- describing things ----------

  function codecName(c) {
    const l = (c || '').toLowerCase();
    if (!l) return '';
    if (/^(dvh1|dvhe|dva1|dvav|dav1)/.test(l)) return 'Dolby Vision';
    if (/^(hvc1|hev1)/.test(l)) return /^(hvc1|hev1)\.2\./.test(l) ? 'HEVC 10-bit' : 'HEVC';
    if (/^avc[13]/.test(l)) return 'H.264';
    if (/^vp0?9/.test(l)) return /^vp09\.\d+\.\d+\.1[02]/.test(l) ? 'VP9 10-bit' : 'VP9';
    if (/^av01/.test(l)) return /^av01\.\d+\.\d+[mh]\.1[02]/.test(l) ? 'AV1 10-bit' : 'AV1';
    if (/^vp8/.test(l)) return 'VP8';
    if (/^(vvc1|vvi1)/.test(l)) return 'VVC';
    return c;
  }

  // ---------- sound ----------

  // { codecs, name, ch: { n, label } | null, joc, bps, rate, lang, label, extra (description/commentary), exact, patterns, hls }
  function audioEntry(a) {
    return { ch: null, joc: false, bps: 0, rate: 0, lang: '', label: '', extra: false, ...a, name: audioCodecName(a.codecs, a.joc) };
  }

  function audioCodecName(c, joc) {
    const l = (c || '').toLowerCase();
    if (/^(ec-3|mp4a\.a6|eac3)/.test(l)) return joc ? 'Dolby Atmos' : 'Dolby Digital Plus';
    if (/^(ac-3|mp4a\.a5|ac3)/.test(l)) return 'Dolby Digital';
    if (/^ac-4/.test(l)) return joc ? 'Dolby Atmos' : 'Dolby AC-4';
    if (/^mp4a\.40\.5$/.test(l)) return 'HE-AAC';
    if (/^mp4a\.40\.29$/.test(l)) return 'HE-AAC v2';
    if (/^(mp4a|aac)/.test(l)) return 'AAC';
    if (/^opus/.test(l)) return 'Opus';
    if (/^flac/.test(l)) return 'FLAC';
    if (/^alac/.test(l)) return 'ALAC';
    if (/^dts/.test(l)) return 'DTS';
    if (/^(mhm1|mha1)/.test(l)) return 'MPEG-H';
    return joc ? 'Dolby Atmos' : c || '';
  }

  function channelsOf(n, label) {
    if (!(n > 0)) return null;
    return { n, label: label || (n === 1 ? 'mono' : n === 2 ? 'stereo' : n === 6 ? '5.1' : n === 8 ? '7.1' : n + ' channels') };
  }

  // MPEG (a channel count), CICP (an index) and Dolby (a 16-bit speaker mask) channel descriptions.
  function dashChannels(el) {
    if (!el) return null;
    const scheme = el.getAttribute('schemeIdUri') || '', v = (el.getAttribute('value') || '').trim();
    if (/23003:3/.test(scheme)) return channelsOf(parseInt(v, 10));
    if (/cicp:ChannelConfiguration/i.test(scheme)) {
      const cicp = { 1: [1], 2: [2], 3: [3, '3.0'], 4: [4, '4.0'], 5: [5, '5.0'], 6: [6], 7: [8], 12: [8], 16: [10, '5.1.4'], 19: [12, '7.1.4'] }[parseInt(v, 10)];
      return cicp ? channelsOf(cicp[0], cicp[1]) : null;
    }
    if (/dolby/i.test(scheme) && /^[0-9a-f]{4}$/i.test(v)) {
      const m = parseInt(v, 16);
      // From the top bit: L C R Ls Rs Lc/Rc Lrs/Rrs Cs Ts Lsd/Rsd Lw/Rw Vhl/Vhr Vhc Lts/Rts LFE2 LFE (pairs count 2; Ts, Vh*, Lts/Rts are height).
      const W = [1, 1, 1, 1, 1, 2, 2, 1, 1, 2, 2, 2, 1, 2, 0, 0], H = [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0];
      let main = 0, high = 0;
      for (let i = 0; i < 14; i++) if (m & (1 << (15 - i))) (H[i] ? (high += W[i]) : (main += W[i]));
      const lfe = (m & 1 ? 1 : 0) + (m & 2 ? 1 : 0);
      if (!main) return null;
      const total = main + high + lfe;
      if (!lfe && !high) return channelsOf(main);
      return channelsOf(total, main + '.' + lfe + (high ? '.' + high : ''));
    }
    return null;
  }

  const audioShort = (a) => (a.name || 'unknown codec') + (a.joc ? '' : a.ch ? ' ' + a.ch.label : '');
  const audioLong = (a) =>
    [audioShort(a), a.rate ? +(a.rate / 1000).toFixed(1) + ' kHz' : '', a.bps ? Math.round(a.bps / 1000) + ' kbps' : ''].filter(Boolean).join(', ');
  // Atmos first, then more channels, then (same codec) a clearly higher bitrate.
  function audioBetter(a, b) {
    if (a.joc !== b.joc) return a.joc;
    const an = a.ch ? a.ch.n : 0, bn = b.ch ? b.ch.n : 0;
    if (an && bn && an !== bn) return an > bn;
    return a.name === b.name && an === bn && b.bps > 0 && a.bps > b.bps * 1.2;
  }

  const playable = new Map();
  // Asks this browser whether it can decode the codec (Media Source first, then plain playback). null: no codec named.
  const canPlayAudio = (codecs) => canPlay('audio', codecs);
  const canPlayVideo = (codecs, mime) => canPlay('video', codecs, mime);
  function canPlay(kind, codecs, mime) {
    if (!codecs) return null;
    const type = (/^(audio|video)\/(mp4|webm)$/i.test(mime || '') ? mime.replace(/^audio/i, kind) : kind + '/mp4') + '; codecs="' + codecs + '"';
    if (playable.has(type)) return playable.get(type);
    let ok = false;
    for (const MS of [window.MediaSource, window.ManagedMediaSource]) {
      try {
        if (MS && MS.isTypeSupported(type)) ok = true;
      } catch (e) {}
    }
    try {
      if (!ok) ok = !!document.createElement(kind).canPlayType(type);
    } catch (e) {}
    playable.set(type, ok);
    return ok;
  }

  // What is playing: WebKit names the enabled track's codec and channels; otherwise the newest audio download
  // since this source started that matches exactly one kind of audio in the video's own quality list.
  function playingAudio(video, ladder) {
    let track = null;
    try {
      const ts = video.audioTracks;
      if (ts) {
        if (!ts.length) return { none: true };
        for (let i = 0; i < ts.length; i++) if (ts[i].enabled) track = ts[i];
      }
    } catch (e) {}
    const cfg = track && track.configuration;
    if (cfg && cfg.codec) {
      const fromList = ladder && ladder.audio.find((a) => a.hls && a.label && a.label === track.label);
      return {
        a: audioEntry({
          codecs: cfg.codec,
          ch: channelsOf(cfg.numberOfChannels),
          joc: !!(fromList && fromList.joc),
          bps: cfg.bitrate || 0,
          rate: cfg.sampleRate || 0,
          lang: track.language || '',
        }),
        how: 'the browser’s track details',
      };
    }
    if (ladder && ladder.audio.length) {
      const since = sessionStart.has(video) ? sessionStart.get(video) : -Infinity;
      let newest = null, owners = [];
      for (const e of recent) {
        if (e.t < since || (newest && e.t <= newest.t)) continue;
        const own = ladder.audio.filter((a) => matches(a, e));
        if (own.length) (newest = e), (owners = own);
      }
      if (owners.length && uniq(owners.map(audioLong)).length === 1) return { a: owners[0], how: 'the video’s own downloads' };
    }
    if (track && ladder) {
      const byName = ladder.audio.filter((a) => a.hls && a.label && a.label === track.label);
      if (byName.length && uniq(byName.map(audioLong)).length === 1) return { a: byName[0], how: 'its name in the stream list' };
    }
    return null;
  }

  // Named by width too, so a letterboxed 1920×800 film still reads as 1080p.
  const tag = (w, h) => (w >= 3800 || h >= 2100 ? '4K' : w >= 2500 || h >= 1400 ? '1440p' : w >= 1900 || h >= 1060 ? '1080p' : w >= 1260 || h >= 700 ? '720p' : h + 'p');
  const sizeName = (w, h) => w + '×' + h + ' (' + tag(w, h) + ')';
  const mbps = (bps) => (bps >= 1e6 ? (bps / 1e6).toFixed(1) + ' Mbps' : Math.round(bps / 1e3) + ' kbps');
  // Matched on height only: anamorphic streams decode to a different width than the list says.
  const near = (v, w, h) => Math.abs(v.h - h) <= Math.max(4, h * 0.03);
  const area = (v) => v.w * v.h;
  const uniq = (xs) => [...new Set(xs.filter(Boolean))];

  function rangeOf(list) {
    const xs = list.map((v) => v.bps).filter((b) => b > 0);
    if (!xs.length) return '';
    const lo = Math.min(...xs), hi = Math.max(...xs);
    if (lo === hi) return mbps(lo);
    return lo >= 1e6 ? (lo / 1e6).toFixed(1) + '–' + mbps(hi) : mbps(lo) + '–' + mbps(hi);
  }

  function topOfVars(vars) {
    const topArea = Math.max(...vars.map(area));
    return vars.filter((v) => area(v) >= topArea * 0.94);
  }
  const topOf = (ladder) => topOfVars(ladder.variants);
  const topKey = (L) => {
    const t = topOf(L)[0];
    return t.w + 'x' + t.h;
  };

  function trackConfig(video) {
    try {
      const tracks = video.videoTracks;
      if (!tracks) return null;
      for (let i = 0; i < tracks.length; i++) {
        if (tracks[i].selected && tracks[i].configuration) return tracks[i].configuration;
      }
    } catch (e) {}
    return null;
  }

  function transferName(cfg) {
    const t = cfg && cfg.colorSpace && cfg.colorSpace.transfer;
    if (!t) return '';
    if (/pq|smpte2084/i.test(t)) return 'HDR10 (PQ)';
    if (/hlg|b67/i.test(t)) return 'HLG';
    return 'SDR';
  }

  // ---------- reading the video ----------

  // On-screen area after the viewport and any clipping ancestors (overflow other than visible).
  function visibleArea(v) {
    const r = v.getBoundingClientRect();
    let left = Math.max(r.left, 0), top = Math.max(r.top, 0);
    let right = Math.min(r.right, window.innerWidth), bottom = Math.min(r.bottom, window.innerHeight);
    let fixed = getComputedStyle(v).position === 'fixed';
    for (let a = v.parentElement; a && a !== document.body && a !== document.documentElement && !fixed && right > left && bottom > top; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const ar = a.getBoundingClientRect();
        left = Math.max(left, ar.left);
        top = Math.max(top, ar.top);
        right = Math.min(right, ar.right);
        bottom = Math.min(bottom, ar.bottom);
      }
      if (cs.position === 'fixed') fixed = true;
    }
    const w = right - left, h = bottom - top;
    if (w <= 0 || h <= 0) return 0;
    if (v.checkVisibility && !v.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return 0;
    const cs = getComputedStyle(v);
    if (cs.visibility !== 'visible' || parseFloat(cs.opacity) === 0) return 0;
    return w * h;
  }

  function mainVideo() {
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    let best = null, bestScore = 0;
    for (const v of document.querySelectorAll('video')) {
      if (fs && fs !== v && !fs.contains(v)) continue;
      const score = visibleArea(v) * (v.paused ? 0.5 : 1) * (v.readyState > 0 ? 1 : 0.1);
      if (score > bestScore) {
        best = v;
        bestScore = score;
      }
    }
    return best;
  }

  const samples = []; // { t, bytes, abytes, frames, video }
  const drops = []; // { t, total, dropped } over the last minute, for judging recent dropped frames
  let playSince = 0, lastSession, lastVideo = null;

  function measure(video) {
    const now = performance.now();
    const q = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : null;
    const bytes = typeof video.webkitVideoDecodedByteCount === 'number' ? video.webkitVideoDecodedByteCount : null;
    const abytes = typeof video.webkitAudioDecodedByteCount === 'number' ? video.webkitAudioDecodedByteCount : null;
    if (samples.length && samples[samples.length - 1].video !== video) (samples.length = 0), (drops.length = 0);
    if (q) {
      drops.push({ t: now, total: q.totalVideoFrames, dropped: q.droppedVideoFrames });
      while (drops.length > 2 && now - drops[1].t > 60000) drops.shift();
    }
    samples.push({ t: now, bytes, abytes, frames: q ? q.totalVideoFrames : null, video });
    while (samples.length > 11) samples.shift();
    // Time since this source first played; a pause doesn’t restart "the first minute", a new source does.
    const session = sessionStart.get(video);
    if (session !== lastSession || video !== lastVideo) (playSince = 0), (lastSession = session), (lastVideo = video);
    if (!video.paused && !playSince) playSince = now;
    const first = samples[0], last = samples[samples.length - 1];
    const secs = (last.t - first.t) / 1000;
    let rate = null, arate = null, fps = null;
    if (secs >= 2 && !video.paused) {
      if (first.bytes != null && last.bytes > first.bytes) rate = ((last.bytes - first.bytes) * 8) / secs;
      if (first.abytes != null && last.abytes > first.abytes) arate = ((last.abytes - first.abytes) * 8) / secs;
      if (first.frames != null && last.frames > first.frames) fps = (last.frames - first.frames) / secs / (video.playbackRate || 1);
    }
    return { q, rate, arate, audioSeen: last.abytes > 0, fps, playingFor: playSince ? (now - playSince) / 1000 : 0 };
  }

  function shownSize(video) {
    const r = video.getBoundingClientRect();
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh || !r.width || !r.height) return null;
    const fit = getComputedStyle(video).objectFit;
    let sx = Math.min(r.width / vw, r.height / vh), sy = sx;
    if (fit === 'cover') sx = sy = Math.max(r.width / vw, r.height / vh);
    else if (fit === 'fill') (sx = r.width / vw), (sy = r.height / vh);
    else if (fit === 'none') sx = sy = 1;
    else if (fit === 'scale-down') sx = sy = Math.min(1, sx);
    const dpr = window.devicePixelRatio || 1;
    return { w: Math.round(vw * sx * dpr), h: Math.round(vh * sy * dpr) };
  }

  function bufferAhead(video) {
    const b = video.buffered, t = video.currentTime;
    for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 0.25 && t <= b.end(i)) return b.end(i) - t;
    return 0;
  }

  function sourceKind(video) {
    const src = video.currentSrc || '';
    if (/^blob:/.test(src)) return 'adaptive stream (Media Source)';
    if (/\.m3u8(\?|#|$)/i.test(src)) return 'HLS (WebKit’s own player)';
    if (/^https?:/.test(src)) return 'single file';
    return src ? src.split(':')[0] : 'none';
  }

  // Which quality list belongs to this video: the HLS list that is its source, or the lists that own
  // the newest download it made since its current source started loading. Anything else: can't tell.
  function chooseLadder(video, vw, vh) {
    if (!ladders.length) return null;
    const src = noFrag(video.currentSrc);
    const direct = ladders.filter((L) => L.kind === 'HLS' && noFrag(L.url) === src);
    if (direct.length) {
      const L = direct[direct.length - 1];
      return L.variants.some((v) => near(v, vw, vh)) ? { state: 'ok', ladder: L, how: 'its source' } : { state: 'nomatch' };
    }
    // Entries arrive in completion order, not start order, so look at all of them for the newest start.
    const since = sessionStart.has(video) ? sessionStart.get(video) : -Infinity;
    let newest = null, owners = [];
    for (const e of recent) {
      if (e.t < since || (newest && e.t <= newest.t)) continue;
      const own = ladders.filter((L) => noFrag(L.url) !== e.name && L.variants.some((v) => matches(v, e)));
      if (own.length) (newest = e), (owners = own);
    }
    if (!newest) return { state: 'unconfirmed' };
    if (uniq(owners.map(topKey)).length > 1) return { state: 'ambiguous' };
    const fit = owners.filter((L) => L.variants.some((v) => near(v, vw, vh)));
    if (!fit.length) return { state: 'nomatch' };
    return { state: 'ok', ladder: fit[fit.length - 1], how: 'its downloads', entry: newest };
  }

  // ---------- what each service offers anywhere ----------

  // The best each service offers on any device, and its cap per desktop browser on a Mac, from the services'
  // own help pages (sources and the date checked: ../SERVICES.md, and ../SOUND.md for `sound`). '' means the service doesn't say.
  // Sound 'spatial' is Netflix's spatial audio (Premium, eligible titles): a 2-channel mix, not 5.1 or Atmos.
  // Checked 18 Oct 2026 (GPT-6.1-Sol, from the services' help pages). '' = not published.
  // computer bests checked 19 Oct 2026 (GPT-6.1-Sol), sources in ../docs/SERVICES.md "Best on any computer".
  const SERVICES = [
    { name: 'Netflix', hosts: ['netflix.com'], best: '4K HDR (Dolby Vision)', where: 'Safari on a Mac, or Netflix’s TV and Windows apps; Premium plan', caps: { chrome: '1080p', safari: '4K', firefox: '1080p', edge: '720p' }, sound: { best: 'Dolby Atmos', where: 'Premium; Apple TV 4K app', caps: { chrome: 'spatial', safari: 'spatial', firefox: 'spatial', edge: 'spatial' } }, pc: { picture: { best: '4K Dolby Vision', cmp: 'Computer best: up to 4K Dolby Vision in Safari on a Mac (Premium; not every film)', mac: 'safari', macName: 'Safari', complete: true }, sound: { best: 'spatial stereo', cmp: 'Mac best: spatial stereo (Premium; eligible titles)', mac: 'any', complete: false } }, off: 'Dolby Atmos (Windows: Edge or the Netflix app; Premium)' },
    { name: 'Prime Video', hosts: ['primevideo.com', 'amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.ca', 'amazon.co.jp', 'amazon.fr', 'amazon.it', 'amazon.es', 'amazon.com.au'], path: /^\/gp\/video\//, pathHost: /(^|\.)amazon\./, best: '4K HDR (Dolby Vision)', where: 'Prime Video’s TV apps, e.g. Apple TV 4K; US 4K needs Prime Video Ultra', caps: { chrome: 'HD', safari: 'HD', firefox: 'HD', edge: 'HD' }, sound: { best: 'Dolby Atmos', where: 'US Ultra; Fire TV / Apple TV apps', caps: { chrome: 'stereo', safari: 'stereo', firefox: 'stereo', edge: 'stereo' } }, pc: { picture: { best: 'HD', cmp: 'Computer best: HD, in browsers and the Mac and Windows apps', mac: 'any', complete: true }, sound: { best: 'stereo', cmp: 'Computer best: stereo, in browsers and the Mac and Windows apps', mac: 'any', complete: true } }, tv: '4K Dolby Vision, Dolby Atmos (US 4K needs Prime Video Ultra)' },
    { name: 'Disney+', hosts: ['disneyplus.com'], best: '4K HDR (Dolby Vision)', where: 'Disney+ TV apps', caps: { chrome: '720p', safari: '720p', firefox: '720p', edge: '720p' }, sound: { best: 'Dolby Atmos / DTS:X', where: 'Premium; TV apps; DTS:X select Android TVs', caps: { chrome: 'stereo', safari: 'stereo', firefox: 'stereo', edge: 'stereo' } }, pc: { picture: { best: '720p', cmp: 'Browsers: up to 720p · Windows app: unknown', mac: 'any', complete: false }, sound: { best: 'stereo', cmp: 'Browsers: stereo · Windows app: unknown', mac: 'any', complete: false } }, tv: '4K Dolby Vision, Dolby Atmos; unconfirmed for computers' },
    { name: 'HBO Max', hosts: ['max.com', 'hbomax.com'], best: '4K HDR (Dolby Vision)', where: 'HBO Max TV apps; Premium plan', caps: { chrome: '720p', safari: '720p', firefox: '720p', edge: '' }, sound: { best: 'Dolby Atmos', where: 'Premium TV apps; select sports Standard/Premium', caps: {} }, pc: { picture: { best: '720p', cmp: 'Website: up to 720p', mac: 'any', complete: false } }, tv: '4K Dolby Vision, Dolby Atmos (Premium); unconfirmed for computers' },
    { name: 'Apple TV+', hosts: ['tv.apple.com'], best: '4K HDR (Dolby Vision)', where: 'Safari on a Mac, or the Apple TV app', caps: { chrome: '1080p', safari: '4K', firefox: '1080p', edge: '1080p' }, sound: { best: 'Dolby Atmos', where: 'Apple TV 4K / compatible native Mac TV app', caps: {} }, pc: { picture: { best: '4K HDR', cmp: 'Computer best: up to 4K HDR in Safari on a Mac or the Apple TV app', mac: 'safari', macName: 'Safari', complete: true }, sound: { best: 'Dolby Atmos', cmp: 'Computer best: Dolby Atmos in the Apple TV app on a Mac, to an Atmos receiver over HDMI', mac: '', complete: true } } },
    { name: 'Hulu', hosts: ['hulu.com'], best: '4K HDR (Dolby Vision)', where: 'Hulu TV apps', caps: { chrome: '720p', safari: '720p', firefox: '720p', edge: '720p' }, sound: { best: '5.1', where: 'both standalone plans; device list unknown', caps: {} }, pc: { picture: { best: '720p', cmp: 'Website: up to 720p', mac: 'any', complete: false } }, tv: '4K Dolby Vision, 5.1; unconfirmed for computers' },
    { name: 'Paramount+', hosts: ['paramountplus.com'], best: '4K HDR (Dolby Vision)', where: 'Paramount+ TV apps; Premium plan', caps: {} , sound: { best: 'Dolby Atmos', where: 'International Premium; supported TV apps', caps: {} }, tv: '4K Dolby Vision, Dolby Atmos (Premium); unconfirmed for computers' },
    { name: 'Peacock', hosts: ['peacocktv.com'], best: '4K (Dolby Vision on some titles)', where: 'some supported 4K devices; Premium plans', caps: {} , sound: { best: 'Dolby Atmos', where: 'eligible titles and devices', caps: {} }, tv: '4K (Dolby Vision on some titles), Dolby Atmos; unconfirmed for computers' },
    { name: 'AMC+', hosts: ['amcplus.com'], best: '', where: '', caps: {} },
    { name: 'MUBI', hosts: ['mubi.com'], best: '4K on selected films', where: 'which devices isn’t stated', caps: {} , sound: { best: '5.1', where: 'Safari on a Mac, tvOS, Fire TV; selected films', caps: { safari: '5.1' } }, pc: { sound: { best: '5.1', cmp: 'Computer best: 5.1 in Safari on a Mac (selected films; needs surround output)', mac: '', complete: false } } },
    { name: 'Criterion Channel', hosts: ['criterionchannel.com'], best: '', where: '', caps: {} },
  ];

  function currentService() {
    // A player in an iframe judges by the page it sits in.
    let host = location.hostname, path = location.pathname;
    try {
      const a = location.ancestorOrigins;
      if (a && a.length) (host = new URL(a[a.length - 1]).hostname), (path = '');
    } catch (e) {}
    host = host.replace(/^www\./, '');
    const on = (h) => host === h || host.endsWith('.' + h);
    return SERVICES.find((s) => s.hosts.some(on) && (!s.path || !path || (s.pathHost && !s.pathHost.test(host)) || s.path.test(path))) || null;
  }

  // Orion is WebKit, but its extensions see Chrome's user agent (pages see Safari's). WebKit-only APIs give it away.
  const isWebKit = () => ('ApplePaySession' in window || 'GestureEvent' in window) && 'videoTracks' in HTMLMediaElement.prototype;
  function browserName() {
    const ua = navigator.userAgent;
    if (/Edg\//.test(ua)) return 'edge';
    if (/Firefox\//.test(ua)) return 'firefox';
    if (/Chrome\/|Chromium\//.test(ua)) return isWebKit() ? 'orion' : 'chrome';
    if (/Safari\//.test(ua)) return 'safari';
    return '';
  }
  // Orion reports itself as Safari, but services don't always treat it the same (AMC+ refuses it).
  const BROWSER_LABEL = { chrome: 'Chrome', safari: 'Safari', firefox: 'Firefox', edge: 'Edge', orion: 'Orion' };
  // 'HD' is Amazon's own word, with no number given; ranked between 720p and 1080p.
  const RANK = { '480p': 1, '540p': 1.5, '576p': 1.5, '720p': 2, HD: 2.5, '1080p': 3, '1440p': 4, '4K': 5 };
  const rankOf = (text) => {
    const m = /\b(4K|\d{3,4}p|HD)\b/.exec(text || '');
    return m ? RANK[m[1]] || (parseInt(m[1], 10) < 480 ? 0.5 : 0) : 0;
  };
  // Atmos 8, surround 6, stereo 2, mono 1. A track (channels / JOC) or a published phrase.
  function soundRank(x) {
    if (x && typeof x === 'object') {
      if (x.joc || /Atmos/.test(x.name || '')) return 8;
      if ((x.ch && x.ch.n >= 6) || /5\.1|7\.1|DTS/.test(x.name || '')) return 6;
      if ((x.ch && x.ch.n === 1) || /mono/i.test((x.name || '') + ' ' + ((x.ch && x.ch.label) || ''))) return 1;
      if ((x.ch && x.ch.n === 2) || /stereo|spatial stereo/i.test((x.name || '') + ' ' + ((x.ch && x.ch.label) || ''))) return 2;
      return 0;
    }
    const text = String(x || '');
    if (/Atmos/.test(text)) return 8;
    if (/5\.1|7\.1|DTS/.test(text)) return 6;
    if (/mono/i.test(text)) return 1;
    if (/stereo|spatial stereo/i.test(text)) return 2;
    return 0;
  }

  // The service's own row: its published cap for this browser and its best anywhere (plain facts, no judgement).
  function serviceRow(svc, b, cap) {
    const where = BROWSER_LABEL[b] || 'this browser';
    return [svc.name, cap ? 'up to ' + cap + ' in ' + where : 'limit for ' + (BROWSER_LABEL[b] || 'this browser') + ': unknown', '', svc.best ? 'best anywhere: ' + svc.best : 'best anywhere: unknown'];
  }

  // ---------- screen refresh and smoothness (only while the host is connected) ----------

  const rafTimes = [];
  let timingOn = false, rafId = null;
  function rafLoop(t) {
    if (!timingOn) return;
    rafTimes.push(t);
    if (rafTimes.length > 121) rafTimes.shift();
    rafId = requestAnimationFrame(rafLoop);
  }

  // How often the browser redraws the page, snapped to a common display rate. Safari normally draws
  // pages at about 60 Hz to save power, even on a 120 Hz screen.
  function refreshHz() {
    if (rafTimes.length < 30) return 0;
    const d = [];
    for (let i = 1; i < rafTimes.length; i++) d.push(rafTimes[i] - rafTimes[i - 1]);
    d.sort((a, b) => a - b);
    const hz = 1000 / d[d.length >> 1];
    if (!isFinite(hz) || hz <= 0) return 0;
    const near = [24, 25, 30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240].reduce((a, b) => (Math.abs(b - hz) < Math.abs(a - hz) ? b : a));
    return Math.abs(near - hz) <= hz * 0.04 ? near : Math.round(hz);
  }

  // When each video frame is due on screen (requestVideoFrameCallback), for the frame-timing checks.
  const frameTimes = []; // { t: expected display time, n: presented frame count, m: media time }
  let frameVideo = null, frameId = null;
  function watchFrames(video) {
    if (!timingOn || !video.requestVideoFrameCallback || frameVideo === video) return;
    if (frameVideo && frameId != null) frameVideo.cancelVideoFrameCallback(frameId);
    frameVideo = video;
    frameTimes.length = 0;
    const cb = (now, meta) => {
      if (frameVideo !== video || !timingOn) return;
      frameTimes.push({ t: meta.expectedDisplayTime || now, n: meta.presentedFrames, m: meta.mediaTime });
      if (frameTimes.length > 150) frameTimes.shift();
      frameId = video.requestVideoFrameCallback(cb);
    };
    frameId = video.requestVideoFrameCallback(cb);
  }

  function setTiming(on) {
    if (on && !timingOn) {
      timingOn = true;
      rafTimes.length = 0;
      rafId = requestAnimationFrame(rafLoop);
    } else if (!on) {
      timingOn = false;
      if (rafId != null) cancelAnimationFrame(rafId);
      if (frameVideo && frameId != null) frameVideo.cancelVideoFrameCallback(frameId);
      rafId = frameId = null;
      rafTimes.length = 0;
      frameVideo = null;
      frameTimes.length = 0;
    }
  }

  // Frame rate from the frames' own timestamps, and whether frames stay on screen for equal times.
  // Unequal times (e.g. 33 ms and 50 ms in turn for 24 fps film on a 60 Hz screen) are what makes pans judder.
  function frameTiming(hz) {
    const shown = [], media = [];
    for (let i = 1; i < frameTimes.length; i++) {
      const a = frameTimes[i - 1], b = frameTimes[i];
      if (b.n - a.n !== 1) continue;
      shown.push(b.t - a.t);
      if (b.m > a.m) media.push(b.m - a.m);
    }
    if (shown.length < 24) return null;
    const median = (xs) => [...xs].sort((x, y) => x - y)[xs.length >> 1];
    const fps = media.length >= 24 ? 1 / median(media) : 0;
    const groups = [];
    for (const x of shown) {
      const g = groups.find((g) => Math.abs(g.v - x) <= 2.5);
      if (g) (g.sum += x), (g.c += 1), (g.v = g.sum / g.c);
      else groups.push({ v: x, sum: x, c: 1 });
    }
    const major = groups.filter((g) => g.c >= shown.length * 0.15).sort((a, b) => a.v - b.v);
    const period = hz ? 1000 / hz : 0;
    const inRefreshes = (ms) => {
      const k = period ? ms / period : 0;
      return k && Math.abs(k - Math.round(k)) < 0.2 ? Math.round(k) : 0;
    };
    const first = frameTimes[0], last = frameTimes[frameTimes.length - 1];
    const skipped = Math.max(0, last.n - first.n - (frameTimes.length - 1));
    let value;
    if (major.length <= 1) {
      const ms = median(shown), k = inRefreshes(ms);
      // Times that aren't whole screen refreshes are planned times (WebKit reports these), not what the screen did.
      if (period && !k) return { fps, even: true, unknown: true, value: 'can’t check here', why: 'browser gives due times (every ' + ms.toFixed(1) + ' ms), not shown times' };
      value = 'even: each frame ' + ms.toFixed(1) + ' ms' + (k ? ' (' + k + ' refreshes)' : '');
    } else {
      const ks = major.map((g) => inRefreshes(g.v));
      value = 'uneven: ' + major.map((g) => g.v.toFixed(1)).join(' / ') + ' ms in turn' + (ks.every(Boolean) ? ' (' + ks.join(' and ') + ' refreshes)' : '');
    }
    if (skipped) value += '; ' + skipped + ' skipped lately';
    return { fps, even: major.length <= 1, skipped, value };
  }

  // ---------- judging each line ----------

  // Typical streaming bitrates in Mbps per size: [H.264], [newer codecs (HEVC, VP9, AV1, Dolby Vision), which need less].
  const TYPICAL = {
    '4K': [[12, 40], [6, 25]],
    '1440p': [[6, 16], [3.5, 10]],
    '1080p': [[3, 8], [1.5, 6]],
    '720p': [[1.5, 5], [0.8, 3.5]],
    sd: [[0.5, 2.5], [0.3, 1.8]],
  };
  const STANDARD_RATES = [[23.976, 'film rate'], [24, 'film rate'], [25, 'TV rate'], [29.97, 'TV rate'], [30, 'TV rate'], [48, 'high frame rate'], [50, 'high frame rate'], [59.94, 'high frame rate'], [60, 'high frame rate']];

  // A measured rate swings with the scene, so it is never judged worse than a Note.
  function judgeBitrate(bps, t, codec, measured) {
    const size = TYPICAL[t] ? t : 'sd';
    const fam = !codec || / or /.test(codec) ? -1 : /H\.264/.test(codec) ? 0 : 1;
    const [lo, hi] = fam < 0 ? [TYPICAL[size][1][0], TYPICAL[size][0][1]] : TYPICAL[size][fam];
    const what = (size === 'sd' ? 'this size' : t) + (fam < 0 ? '' : ' ' + codec.replace(/ 10-bit$/, ''));
    const range = 'typical ' + what + ': ' + lo + '–' + hi;
    if (bps / 1e6 >= lo) return ['normal', range];
    if (measured) return ['note', 'lean; ' + range + '; varies by scene'];
    return [bps / 1e6 < lo / 2 ? 'unusual' : 'note', 'lean; ' + range];
  }

  // Data per pixel: video bits per pixel per frame, then made comparable across codecs and sizes. Newer codecs need
  // fewer bits for the same picture (rough rule: HEVC, VP9 and Dolby Vision about 1.6× as efficient as H.264, AV1 and
  // VVC about 2×), and bigger frames need fewer bits per pixel (scaled by the fourth root of the area, from 1080p).
  // The grade bands are a rough guide (Andy asked for one, 21 Oct 2026); a typical 1080p Blu-ray (H.264, about
  // 30 Mbps at 24 fps) scores about 0.6. A per-title encoder gives cartoons fewer bits on purpose.
  // Disc bands as shares of the Blu-ray reference (adjusted 0.30, 0.15, 0.09 and 0.055 bits per pixel over 0.6).
  const DISC_BPP = 0.6;
  const GRADES = [[0.3, 'A'], [0.15, 'B'], [0.09, 'C'], [0.055, 'D'], [0, 'F']].map(([x, l]) => [x / DISC_BPP, l]);
  // The streaming grade compares the same figure with a high mainstream streaming reference at the playing size, in
  // the same units (H.264-equivalent Mbps at 24 fps → adjusted bits per pixel). From GPT-6.1-Sol's sourced research
  // (21 Oct 2026): 4K 46.4 (Apple TV+, 29 Mbps HEVC, measured report), 1080p 11.2 (Max, 6.99 Mbps HEVC, measured
  // report), 720p 4.5 (Apple's HLS authoring target; a fallback, not a measured maximum). High references, not
  // service ceilings. Other sizes have none. Bands are a rough guide (Andy asked for this grade, 21 Oct 2026).
  const STREAM_REF = { '4K': 0.33, '1080p': 0.225, '720p': 0.166 };
  const SGRADES = [[0.8, 'A', 'generous data'], [0.55, 'B', 'solid data'], [0.35, 'C', 'moderate data'], [0.2, 'D', 'lean data'], [0, 'F', 'very lean data']];
  const letterOf = (bands, x) => bands.find(([min]) => x >= min);
  const pctText = (r) => (r >= 0.95 && r < 1.05 ? 'about 100%' : r >= 0.15 ? 'about ' + Math.round(r * 10) * 10 + '%' : 'under 15%');
  function dataGrade(bps, w, h, fps, codec) {
    if (!(bps > 0 && w > 0 && h > 0 && fps > 0) || !codec || / or /.test(codec)) return null;
    const factor = /H\.264/.test(codec) ? 1 : /AV1|VVC/.test(codec) ? 2 : /HEVC|VP9|Dolby Vision/.test(codec) ? 1.6 : 0;
    if (!factor) return null;
    const bpp = bps / (w * h * fps);
    return { bpp, adj: bpp * factor * Math.pow((w * h) / (1920 * 1080), 0.25) };
  }
  // Both grades for a figure that may be a range: hi is the figure graded, lo the low end when it is uncertain
  // (null: no low end known, as with a peak figure). Uncertainty always shows, even when both ends share a letter.
  function grades(hi, lo, uncertain, size) {
    const span = (bands, f) => {
      const a = letterOf(bands, f(hi.adj));
      if (!uncertain) return { letter: a[1], word: a[2] || '', pct: pctText(f(hi.adj)) };
      const p0 = pctText(f(hi.adj)), pct = /^under/.test(p0) ? p0 : 'up to ' + p0.replace(/^about /, '');
      if (!lo) return { letter: a[1] === 'F' ? 'F' : a[1] + ' or lower', word: a[2] ? a[2] + ' or less' : '', pct };
      const z = letterOf(bands, f(Math.max(0, lo.adj)));
      const far = bands.indexOf(z) - bands.indexOf(a) > 1;
      return { letter: a === z ? 'up to ' + a[1] : a[1] + (far ? ' to ' : ' or ') + z[1], word: a === z ? a[2] || '' : a[2] ? a[2] + (far ? ' to ' : ' or ') + z[2] : '', pct };
    };
    const ref = STREAM_REF[size];
    return { bpp: hi.bpp, disc: span(GRADES, (x) => x / DISC_BPP), stream: ref ? span(SGRADES, (x) => x / ref) : null };
  }

  // What is drawn over the video or applied to it, read from the page's layout: effects (filter, opacity, blend) on the
  // video and the elements holding it, and visible elements later in the page (or raised above it) that cover part of it.
  // Page order is a stand-in for stacking order, and closed shadow roots and the browser's own compositing can't be seen.
  // A CSS colour's alpha and whether it is dark (rgb()/rgba() and color(srgb …)); other colour spaces: lightness unknown.
  function colourOf(c) {
    const m = /^(rgba?|color)\(([^)]*)\)$/.exec((c || '').trim());
    if (!m) return null;
    const [main, slash] = m[2].split('/');
    const p = main.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
    let a = slash != null ? slash.trim() : m[1] !== 'color' && p.length >= 4 ? p[3] : '1';
    a = parseFloat(a) * (/%/.test(a) ? 0.01 : 1);
    let rgb = null;
    if (m[1] === 'color') rgb = /^(srgb|srgb-linear|display-p3)$/.test(p[0]) ? p.slice(1, 4).map(Number) : null;
    else rgb = p.slice(0, 3).map((x) => parseFloat(x) / (/%/.test(x) ? 100 : 255));
    const lum = rgb && rgb.every((x) => isFinite(x)) ? 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] : null;
    return isFinite(a) ? { a, dark: lum == null ? null : lum < 0.35 } : null;
  }
  const coloursIn = (img) => [...(img || '').matchAll(/(?:rgba?|color)\([^)]*\)/g)].map((x) => colourOf(x[0])).filter(Boolean);
  // Paint rank of an element's branch under a shared ancestor: negative z-index < not positioned < positioned < higher z-index.
  function paintRank(node, common) {
    let top = node;
    while (top.parentElement && top.parentElement !== common) top = top.parentElement;
    const cs = getComputedStyle(top);
    const z = parseInt(cs.zIndex, 10);
    if (cs.position === 'static') return 0;
    return isFinite(z) ? (z < 0 ? -1 : 1 + z) : 1;
  }
  // The picture's own rectangle inside the video element (object-fit contain leaves bars).
  function pictureRect(video) {
    const r = video.getBoundingClientRect();
    const vw = video.videoWidth, vh = video.videoHeight;
    const fit = getComputedStyle(video).objectFit;
    if (!vw || !vh || fit === 'fill' || fit === 'cover') return r;
    let k = Math.min(r.width / vw, r.height / vh);
    if (fit === 'none') k = 1;
    else if (fit === 'scale-down') k = Math.min(1, k);
    const w = vw * k, h = vh * k, left = r.left + (r.width - w) / 2, top = r.top + (r.height - h) / 2;
    return { left, top, right: left + w, bottom: top + h, width: w, height: h };
  }
  function overlays(video) {
    const effects = [];
    for (let a = video; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const who = a === video ? 'video' : 'player';
      if (cs.filter && cs.filter !== 'none') effects.push(who + ' filter ' + cs.filter);
      if (parseFloat(cs.opacity) < 1) effects.push(who + ' opacity ' + Math.round(parseFloat(cs.opacity) * 100) + '%');
      if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') effects.push(who + ' blend ' + cs.mixBlendMode);
    }
    const vr = pictureRect(video);
    const varea = vr.width * vr.height;
    const found = [];
    if (varea > 0) {
      let box = video.parentElement;
      for (let i = 0; i < 6 && box && box.parentElement && box.parentElement !== document.documentElement; i++) {
        const r = box.parentElement.getBoundingClientRect();
        if (r.width * r.height > varea * 1.6) break;
        box = box.parentElement;
      }
      const els = box ? box.querySelectorAll('*') : [];
      const seen = new Set();
      for (let i = 0; i < els.length && i < 1500; i++) {
        const el = els[i];
        if (el === video || el.contains(video) || el.hasAttribute('data-stream-quality-hud')) continue;
        const r = el.getBoundingClientRect();
        const ow = Math.min(r.right, vr.right) - Math.max(r.left, vr.left), oh = Math.min(r.bottom, vr.bottom) - Math.max(r.top, vr.top);
        const hint = (typeof el.className === 'string' ? el.className : '') + ' ' + (el.id || '') + ' ' + (el.getAttribute('data-testid') || '');
        const captions = /caption|subtitle|timedtext|cue/i.test(hint) && el.textContent.trim();
        if (ow <= 0 || oh <= 0 || (!captions && (ow * oh) / varea < 0.01)) continue;
        // Above the video: a higher paint rank under their shared ancestor, or the same rank and later in the page.
        let common = video.parentElement;
        while (common && !common.contains(el)) common = common.parentElement;
        if (!common) continue;
        const rv = paintRank(video, common), re = paintRank(el, common);
        if (re < rv || (re === rv && !(video.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING))) continue;
        const cs = getComputedStyle(el);
        if (el.checkVisibility ? !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : cs.visibility !== 'visible') continue;
        let op = 1;
        for (let a = el; a && a !== common.parentElement; a = a.parentElement) op *= parseFloat(getComputedStyle(a).opacity);
        const cover = Math.round((100 * ow * oh) / varea);
        const tagName = el.localName;
        // The element's own background, then its ::before and ::after layers.
        const fills = [cs];
        for (const pe of ['::before', '::after']) {
          const ps = getComputedStyle(el, pe);
          if (ps.content && ps.content !== 'none' && ps.display !== 'none') fills.push(ps);
        }
        let kind = '', dark = 0, light = 0, unknownTone = false;
        const take = (c, o) => {
          if (c.dark === true) dark = Math.max(dark, c.a * o);
          else if (c.dark === false) light = Math.max(light, c.a * o);
          else unknownTone = true;
        };
        if (captions) kind = 'subtitles';
        else if (/^(canvas|video|img|svg|iframe)$/.test(tagName) && cover >= 5) kind = tagName === 'img' || tagName === 'svg' ? 'image' : tagName;
        else {
          for (const f of fills) {
            const o = op * (f === cs ? 1 : parseFloat(f.opacity) || 0);
            if (/gradient/.test(f.backgroundImage)) {
              const cols = coloursIn(f.backgroundImage);
              if (cols.some((c) => c.a > 0)) ((kind = kind === 'solid' ? kind : 'shade'), cols.forEach((c) => take(c, o)));
            }
            const bg = colourOf(f.backgroundColor);
            if (bg && bg.a > 0 && cover >= 5) {
              if (bg.a * o >= 0.95) kind = 'solid';
              else if (kind !== 'solid') kind = kind || 'tint';
              take(bg, o);
            }
          }
          if (!kind && /^(button|input)$/.test(tagName)) kind = 'controls';
        }
        if (!kind || seen.has(el.parentElement)) continue;
        seen.add(el);
        found.push({ kind, cover, dark, light, unknownTone });
      }
    }
    try {
      for (const t of video.textTracks || []) if (t.mode === 'showing' && t.activeCues && t.activeCues.length) found.push({ kind: 'subtitles', cover: 0, dark: 0 });
    } catch (e) {}
    const by = (k) => found.filter((f) => f.kind === k);
    const parts = [];
    const shades = by('shade').concat(by('tint'));
    if (shades.length) {
      const dark = Math.max(...shades.map((f) => f.dark)), light = Math.max(...shades.map((f) => f.light));
      const tone = [dark > 0.005 ? 'up to ' + Math.round(dark * 100) + '% dark' : '', light > 0.005 ? 'up to ' + Math.round(light * 100) + '% light' : '', shades.some((f) => f.unknownTone) ? 'tone unknown' : ''].filter(Boolean).join(', ');
      parts.push((by('shade').length ? 'shading' : 'tint') + ' over ' + Math.min(100, Math.max(...shades.map((f) => f.cover))) + '%' + (tone ? ', ' + tone : ''));
    }
    if (by('solid').length) parts.push('solid layer over ' + Math.max(...by('solid').map((f) => f.cover)) + '%');
    if (by('subtitles').length) parts.push('subtitles');
    if (by('controls').length) parts.push('player controls');
    for (const k of ['canvas', 'video', 'image', 'iframe']) if (by(k).length) parts.push(k + (by(k).length > 1 ? ' ×' + by(k).length : ''));
    return { effects, parts, shadeDark: shades.length ? Math.max(...shades.map((f) => f.dark)) : 0, shadeLight: shades.length ? Math.max(...shades.map((f) => f.light)) : 0, solid: by('solid').length > 0 };
  }

  // A version's identity: HLS variants that share a playlist are one picture (they differ only in their sound group).
  const versionKey = (v) => (v.hls ? [...v.exact][0] || '' : [v.w, v.h, v.bps, v.codecs, v.range].join('|'));

  // ---------- the report ----------

  function report() {
    const video = mainVideo();
    if (!video) return { wait: true, title: 'No video yet', pill: 'No video yet', dot: 'unk', sections: [] };
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return { wait: true, title: 'Waiting for first frame', pill: 'Waiting for first frame', dot: 'unk', sections: [{ name: 'Playback', rows: [['Source', sourceKind(video), '', '']] }] };

    const m = measure(video);
    const cfg = trackConfig(video);
    watchFrames(video);
    if (/\.m3u8(\?|#|$)/i.test(video.currentSrc || '')) consider(video.currentSrc);
    const found = chooseLadder(video, vw, vh);
    const ladder = found && found.state === 'ok' ? found.ladder : null;
    const b = browserName();
    const B = b === 'safari' ? 'Safari' : BROWSER_LABEL[b] || 'this browser';
    const svc = currentService();
    const cap = (svc && b && svc.caps[b]) || '';
    // Amazon's "HD" gives no number; 720p and up count as within it.
    const capRank = cap === 'HD' ? RANK['720p'] : rankOf(cap);
    let hostName = location.hostname;
    try {
      const a = location.ancestorOrigins;
      if (a && a.length) hostName = new URL(a[a.length - 1]).hostname;
    } catch (e) {}
    hostName = hostName.replace(/^www\./, '');
    const S = svc ? svc.name : hostName;
    const playing = ladder ? ladder.variants.filter((v) => near(v, vw, vh)) : [];
    const exact = found && found.entry ? playing.filter((v) => matches(v, found.entry)) : [];
    const codec = codecName(cfg && cfg.codec) || uniq((exact.length ? exact : playing).map((v) => codecName(v.codecs))).join(' or ');
    const playingRange = transferName(cfg) || (playing.length && uniq((exact.length ? exact : playing).map((v) => v.range || 'SDR')).join(' or ')) || '';
    const isHdr = /HDR|HLG|Dolby/.test(playingRange) && !/ or /.test(playingRange);
    const shown = shownSize(video);
    const screenHdr = !!(window.matchMedia && matchMedia('(dynamic-range: high)').matches);
    const playTag = tag(vw, vh);
    const early = m.playingFor < 60;

    // Frame rate first: the data grade needs it.
    const hz = refreshHz();
    const ft = frameTiming(hz);
    const listedFps = (cfg && cfg.framerate) || (exact.length === 1 && exact[0].fps) || (uniq(playing.map((v) => v.fps)).length === 1 && playing[0].fps) || (ft && ft.fps);
    const fps = listedFps || m.fps;

    // Picture: against the best version this browser says it can play in the video's own list, else the service's published cap.
    let pic, topVs = null, topV = null, topPlay = null, count = 0;
    if (ladder) {
      topVs = topOf(ladder);
      topV = topVs[0];
      count = uniq(ladder.variants.map(versionKey)).length;
      const playableVars = ladder.variants.filter((v) => near(v, vw, vh) || canPlayVideo(v.codecs, v.mime) !== false);
      topPlay = playableVars.length ? topOfVars(playableVars) : topVs;
      if (topPlay.some((v) => near(v, vw, vh))) {
        if (area(topPlay[0]) < area(topV) * 0.94) pic = 'topplayable';
        else pic = uniq(topPlay.map(versionKey)).length > 1 && rangeOf(topPlay).includes('–') && exact.length !== 1 ? 'topsize' : 'top';
      } else pic = 'lower';
    } else if (capRank && rankOf(playTag) >= capRank) pic = 'atcap';
    else if (capRank) pic = 'belowcap';
    else pic = 'unknown';
    const sizeBest = ['top', 'topsize', 'topplayable', 'atcap'].includes(pic);
    const bestHere = topPlay ? tag(topPlay[0].w, topPlay[0].h) : cap === 'HD' ? '720p' : cap || playTag;
    // HDR: a version at this size the browser says it can play, while SDR plays on an HDR screen.
    const hdrHere = ladder ? ladder.variants.filter((v) => v.range && near(v, vw, vh)) : [];
    const hdrPlayable = hdrHere.filter((v) => canPlayVideo(v.codecs, v.mime) === true);
    const missingHdr = !isHdr && /SDR/.test(playingRange) && screenHdr && hdrPlayable.length > 0;

    // Sound: what plays, and the best audio of the same language in the video's own list.
    const pa = playingAudio(video, ladder);
    const pA = pa && pa.a;
    const pool = (ladder ? ladder.audio : []).filter((a) => !a.extra && (!pA || !pA.lang || !a.lang || a.lang.slice(0, 2) === pA.lang.slice(0, 2)));
    let bestA = null;
    for (const a of pool) if (!bestA || audioBetter(a, bestA)) bestA = a;
    const canBest = bestA ? canPlayAudio(bestA.codecs) : null;
    let snd;
    if (pa && pa.none) snd = 'none';
    else if (pA && bestA && audioBetter(bestA, pA)) snd = canBest === false ? 'cant' : 'lower';
    else if (pA) snd = bestA ? 'best' : 'known';
    else snd = 'unknown';
    const ss = svc && svc.sound;
    const sCap = ss && b ? ss.caps[b] || '' : '';
    const sCapText = sCap === 'spatial' ? 'Netflix spatial audio (2-channel mix; Premium, selected titles)' : sCap;
    const BA = bestA ? (pA && audioShort(pA) === audioShort(bestA) ? audioLong(bestA) : audioShort(bestA)) : '';
    const surroundAny = [pA, bestA].some((a) => a && (a.joc || (a.ch && a.ch.n > 2)));

    // ---- Picture
    const pictureRows = [];
    const playJ = {
      top: ['normal', ''],
      topsize: ['normal', ''],
      topplayable: ['normal', 'best ' + B + ' can play'],
      lower: early ? ['note', 'players start low; give it a minute'] : ['unusual', S + '’s stream list goes to ' + (topPlay ? tag(topPlay[0].w, topPlay[0].h) : '')],
      atcap: ['normal', cap === 'HD' ? '“HD” is ' + S + '’s word; no number' : ''],
      belowcap: early ? ['note', 'players start low; give it a minute'] : ['note', 'up to ' + cap + ' if title and plan allow'],
      unknown: ['note', found ? 'no confirmed stream list' : 'no stream list seen'],
    }[pic];
    pictureRows.push(['Playing', sizeName(vw, vh) + (codec ? ', ' + codec : ''), ...playJ]);
    if (ladder) {
      const ranges = uniq(ladder.variants.map((v) => v.range));
      pictureRows.push([
        'Top sent',
        topV.w + '×' + topV.h + ', ' + uniq(topVs.map((v) => codecName(v.codecs))).join(' / ') + (rangeOf(topVs) ? ', ' + rangeOf(topVs) : ''),
        '',
        count + (count === 1 ? ' version, ' : ' versions, ') + (ranges.length ? 'with ' + ranges.join(' and ') : 'all SDR') + ' (' + ladder.kind + (ladder.part ? ', ' + ladder.part : '') + '); matched to ' + found.how,
      ]);
    } else if (found) {
      const tops = uniq(ladders.map((L) => tag(topOf(L)[0].w, topOf(L)[0].h)));
      pictureRows.push(['Stream lists', ladders.length + ' (best in them: ' + tops.join(', ') + ')', 'note', { ambiguous: 'disagree on the best', nomatch: 'video’s stream list lacks its size', unconfirmed: 'none confirmed as video’s' }[found.state]]);
    }
    if (svc) pictureRows.push(serviceRow(svc, b, cap));
    let colJ;
    if (isHdr) colJ = screenHdr ? ['normal', 'HDR on an HDR screen'] : ['note', 'SDR-only screen shows it as SDR'];
    else if (!playingRange) colJ = ['note', B + ' doesn’t say'];
    else if (/ or /.test(playingRange)) colJ = ['note', 'both listed at this size; can’t tell which'];
    else if (missingHdr) colJ = ['unusual', hdrPlayable[0].range + ' listed at this size; ' + B + ' can play it'];
    else if (hdrPlayable.length) colJ = ['normal', hdrPlayable[0].range + ' listed; screen is SDR only'];
    else if (hdrHere.length) colJ = hdrHere.every((v) => canPlayVideo(v.codecs, v.mime) === false)
      ? ['normal', 'listed HDR needs a codec ' + B + ' lacks']
      : ['note', 'HDR listed; codec support not reported'];
    else if (ladder && ladder.variants.some((v) => v.range)) colJ = ['normal', 'listed HDR is other sizes'];
    else if (ladder) colJ = ['normal', 'no HDR listed' + (screenHdr ? '' : '; screen is SDR only')];
    else colJ = ['note', 'no stream list to check'];
    pictureRows.push(['Colour', playingRange || 'not reported', ...colJ]);
    const listed = exact.length === 1 ? exact : playing;
    let videoBps = 0, lowBps = 0, gradeHow = '', soundBound = 0;
    if (listed.length && rangeOf(listed)) {
      const bps = Math.max(...listed.map((v) => v.bps));
      const j = judgeBitrate(bps, playTag, codec, false);
      if (exact.length !== 1 && rangeOf(listed).includes('–')) j[1] += '; judged on high end';
      pictureRows.push(['Bitrate', rangeOf(listed) + ' listed' + (ladder.kind === 'HLS' ? ' (incl. sound)' : '') + (m.rate ? ', ' + mbps(m.rate) + ' measured' : ''), ...j]);
      // An HLS figure covers the video plus its largest sound pairing (RFC 8216 4.3.4.2): take that off when every
      // listed sound track gives its bitrate; otherwise grade the total and say it may read a little high.
      const aBps = ladder.kind === 'HLS' && ladder.audio.length && ladder.audio.every((a) => a.bps > 0) ? Math.max(...ladder.audio.map((a) => a.bps)) : 0;
      videoBps = aBps && aBps < bps / 2 ? bps - aBps : bps;
      const withSound = ladder.kind === 'HLS' && ladder.audio.length > 0 && videoBps === bps;
      gradeHow = withSound ? 'listed incl. sound' : 'listed';
      // Sound bitrates unlisted: grade a range, allowing up to 768 kbps of sound (streaming Atmos tops out about there).
      if (withSound) soundBound = 768000;
      // Several bitrates at this size and the exact one unknown: the low end bounds the grade too.
      lowBps = (exact.length !== 1 && rangeOf(listed).includes('–') ? Math.min(...listed.map((v) => v.bps).filter((x) => x > 0)) - (videoBps < bps ? bps - videoBps : 0) : videoBps) - soundBound;
      if (lowBps < videoBps && exact.length !== 1 && rangeOf(listed).includes('–')) gradeHow += '; exact version unknown';
    } else if (cfg && cfg.bitrate) {
      pictureRows.push(['Bitrate', mbps(cfg.bitrate) + ' (track)', ...judgeBitrate(cfg.bitrate, playTag, codec, false)]);
      (videoBps = cfg.bitrate), (gradeHow = 'track');
    } else if (m.rate) {
      pictureRows.push(['Bitrate', mbps(m.rate) + ', measured', ...judgeBitrate(m.rate, playTag, codec, true)]);
      (videoBps = m.rate), (gradeHow = 'measured; varies by scene');
    }
    const hiG = dataGrade(videoBps, vw, vh, fps, codec);
    const fromList = /^listed/.test(gradeHow);
    const peakOnly = fromList && listed.some((v) => v.peak) && videoBps === Math.max(...listed.map((v) => v.bps));
    if (peakOnly) gradeHow = gradeHow.replace(/^listed/, 'listed peak');
    const rangeKnown = fromList && lowBps < videoBps;
    const loG = rangeKnown ? (lowBps > 0 ? dataGrade(lowBps, vw, vh, fps, codec) : { adj: 0 }) : null;
    const grade = hiG ? grades(hiG, peakOnly ? null : loG, rangeKnown || peakOnly, tag(vw, vh)) : null;
    if (grade) {
      const how = ' (' + gradeHow + (listedFps ? '' : ', rough frame rate') + ')';
      const sg = grade.stream, dg = grade.disc;
      if (sg) pictureRows.push(['Streaming grade', sg.letter + ' · ' + sg.word, /[DF]$/.test(sg.letter) ? 'note' : 'normal', sg.pct + ' of a high ' + playTag + ' streaming reference; codec-adjusted' + how + '. A rough data guide, not a picture-quality measurement.']);
      else pictureRows.push(['Streaming grade', 'reference unavailable', '', 'no high streaming reference for ' + playTag]);
      pictureRows.push([
        'Disc grade',
        dg.letter + ' · ' + dg.pct + ' of the Blu-ray reference',
        /F$/.test(dg.letter) && !/ /.test(dg.letter) ? 'unusual' : /[DF]$/.test(dg.letter) ? 'note' : 'normal',
        (/ /.test(dg.letter) ? 'up to ' : '') + grade.bpp.toFixed(3) + ' bits per pixel; compared with 1080p H.264 at 30 Mbps and 24 fps; codec-adjusted' + how + '. A rough data guide.',
      ]);
    }
    const ov = overlays(video);
    {
      const bits = ov.effects.concat(ov.parts);
      const j = ov.effects.length
        ? ['unusual', 'the page changes the picture itself']
        : ov.solid
          ? ['unusual', 'a solid layer hides part of the picture']
          : ov.shadeDark >= 0.25
            ? ['note', 'darkens part of the picture; players usually fade it with the controls']
            : ov.shadeLight >= 0.25
              ? ['note', 'lightens part of the picture; players usually fade it with the controls']
            : bits.length
              ? ['normal', 'drawn on top; the picture itself is untouched']
              : ['normal', 'none seen in the page’s layout; a player can hide layers from this check'];
      pictureRows.push(['Overlays', bits.length ? bits.join('; ') : 'none found', ...j]);
    }
    if (shown) {
      const k = shown.h / vh;
      pictureRows.push([
        'On screen',
        shown.w + '×' + shown.h + ' px' + (k > 1.05 ? ', enlarged ' + k.toFixed(1) + '×' : k < 0.95 ? ', shrunk' : ', about original size'),
        ...(k <= 1.05 ? ['normal', 'full detail'] : sizeBest ? ['normal', 'screen finer than stream'] : k >= 1.3 ? ['note', 'softer than native'] : ['normal', '']),
      ]);
    }

    // ---- Sound
    const soundRows = [];
    const measuredA = m.arate ? Math.round(m.arate / 1000) + ' kbps' : '';
    if (snd === 'none') soundRows.push(['Playing', 'no sound track', 'note', '']);
    else if (pA) {
      const surround = pA.joc || (pA.ch && pA.ch.n > 2);
      const j = {
        best: ['normal', 'best listed'],
        cant: ['normal', B + ' can’t play ' + (bestA && bestA.name)],
        lower: canBest ? ['note', BA + ' listed; ' + S + '’s player chose this one'] : ['note', BA + ' listed'],
        known: surround || !pA.bps || pA.bps >= 96000 ? ['normal', surround ? 'surround' : pA.bps ? 'typical streaming sound' : ''] : ['note', 'low for film sound'],
      }[snd];
      soundRows.push(['Playing', audioLong(pA) + (measuredA ? ', ' + measuredA + ' measured' : ''), ...j]);
    } else soundRows.push(['Playing', measuredA ? 'about ' + measuredA + ', measured' : 'not reported', 'note', 'format and channels not reported']);
    if (ss) soundRows.push([S, sCap ? sCapText + ' in ' + B : 'limit for ' + B + ': unknown', '', ss.best ? 'best anywhere: ' + ss.best : 'best sound anywhere: unknown']);
    if (bestA && snd !== 'best') soundRows.push(['Top sent', audioLong(bestA), '', canBest === false ? B + ' can’t play it' : canBest && snd === 'lower' ? B + ' says it can decode it; the player didn’t pick it' : canBest ? B + ' says it can decode it' : '']);
    if (b === 'chrome') soundRows.push(['After this', 'Movie Sound, Chrome audio extension', '', 'after the browser; both on = processed twice']);
    else soundRows.push(['After this', 'Movie Sound, if on', '', 'after the browser' + (surroundAny ? ', on stereo (surround folded)' : '') + '; not seen here']);

    // ---- Playback
    const playbackRows = [];
    if (fps) {
      const near2 = (tol) => STANDARD_RATES.find(([r]) => Math.abs(fps - r) <= r * tol);
      const std = listedFps ? near2(0.005) : near2(0.02);
      playbackRows.push(['Frame rate', Math.round(fps * 1000) / 1000 + ' fps', ...(std ? ['normal', std[1] + (listedFps ? '' : ', measured')] : listedFps ? ['unusual', 'not a film or TV rate'] : ['note', 'measured roughly'])]);
    }
    if (hz) {
      const k = fps ? hz / fps : 0;
      let j;
      if (b === 'safari' && hz <= 61) j = ['normal', 'Safari’s page limit, not the video’s'];
      else if (k && Math.abs(k - Math.round(k)) < 0.05) j = ['normal', Math.round(k) + ' refreshes per frame'];
      else if (k) j = ['note', 'uneven refreshes per frame'];
      else j = ['normal', ''];
      playbackRows.push(['Refresh', hz + ' Hz', ...j]);
    }
    if (ft) {
      const j = ft.unknown ? ['note', ft.why] : !ft.even ? ['unusual', 'slow pans can judder'] : ft.skipped ? ['note', 'some skipped lately'] : ['normal', 'equal frame times'];
      playbackRows.push(['Smoothness', ft.value, ...j]);
    } else if (!video.paused && !video.requestVideoFrameCallback) playbackRows.push(['Smoothness', 'not reported', 'note', 'frame timing not reported']);
    else playbackRows.push(['Smoothness', 'measuring…', '', '']);
    let d = 0, t = 0, p = 0, n = 0, when = '';
    if (m.q) {
      t = m.q.totalVideoFrames;
      d = m.q.droppedVideoFrames;
      const pct = t ? (100 * d) / t : 0;
      // Judged on the last minute, so one hiccup (a seek, a busy moment) doesn't mark the rest of the film.
      const first = drops[0], last = drops[drops.length - 1];
      const rt = first && last ? last.total - first.total : 0, rd = first && last ? last.dropped - first.dropped : 0;
      if (rt >= 240) (n = rt), (p = (100 * rd) / rt), (when = 'last minute: ');
      else (n = t), (p = pct), (when = '');
      const j = n < 240 ? ['note', 'too early to judge'] : p < 0.5 ? ['normal', when + 'under 0.5%'] : p <= 2 ? ['note', when + p.toFixed(1) + '%; fine unless it grows'] : ['unusual', when + p.toFixed(1) + '%: expect stutter'];
      playbackRows.push(['Dropped', d + ' of ' + t.toLocaleString() + ' frames' + (t ? ' (' + pct.toFixed(pct && pct < 0.1 ? 2 : 1) + '%)' : ''), ...j]);
    }
    const ahead = bufferAhead(video);
    const low = !video.paused && m.playingFor > 10 && ahead < 3 && !(video.duration - video.currentTime < 5);
    playbackRows.push(['Buffered', Math.round(ahead) + ' s ahead', ...(low ? (early ? ['note', 'low; still filling'] : ['unusual', 'low; may stall']) : ['normal', ''])]);
    playbackRows.push(['Source', sourceKind(video), '', '']);

    // ---- three scorecard rows (Picture, Sound, Playback)
    const pcPic = svc && svc.pc && svc.pc.picture;
    const pcSnd = svc && svc.pc && svc.pc.sound;
    const pcRank = pcPic ? (pcPic.best === 'HD' ? RANK['1080p'] : rankOf(pcPic.best)) : 0;
    const hdUnconfirmed = pic === 'atcap' && cap === 'HD' && rankOf(playTag) < RANK['1080p'];
    const singleRange = playingRange && !/ or /.test(playingRange) ? playingRange.replace(' (PQ)', '') : '';
    const pv = playTag + (singleRange ? ' ' + singleRange : '');
    const topTag = topPlay ? tag(topPlay[0].w, topPlay[0].h) : '';
    const aS = pA ? audioShort(pA) : '';
    let picNow;
    if (pic === 'top' || pic === 'topsize') picNow = pv + ' · ' + (count === 1 ? 'only version sent to ' + B : 'top of ' + count + ' sent to ' + B);
    else if (pic === 'topplayable') picNow = pv + ' · top ' + B + ' can play; ' + tag(topV.w, topV.h) + ' sent needs ' + uniq(topVs.map((v) => codecName(v.codecs))).join(' / ') + ', which ' + B + ' can’t play';
    else if (pic === 'lower') picNow = pv + ' · ' + S + ' sent ' + B + ' up to ' + topTag;
    else if (pic === 'atcap') picNow = (cap === 'HD' ? pv + ' · within “HD”, ' : pv + ' · ') + S + '’s most for ' + B;
    else if (pic === 'belowcap') picNow = pv + ' · ' + S + ' offers ' + B + ' up to ' + cap;
    else {
      picNow = pv + ' · ' + ({
        none: 'no stream list seen',
        ambiguous: S + '’s stream lists disagree',
        nomatch: S + '’s stream list lacks ' + vw + '×' + vh,
        unconfirmed: 'no stream list confirmed as this video’s',
      }[found ? found.state : 'none']);
    }
    if (missingHdr) picNow = pv + ' · ' + hdrPlayable[0].range + ' sent at this size; ' + B + ' can play it';
    if (hdUnconfirmed) picNow = pv + ' · within ' + S + '’s “HD”; its top size isn’t published';
    // Andy asked for each grade's letter, meaning and percent on the scorecard (21 Oct 2026).
    let picNote = '';
    if (grade) {
      const sg = grade.stream, dg = grade.disc;
      picNow += (sg ? ' · streaming ' + sg.letter : '') + ' · disc ' + dg.letter;
      picNote = (sg ? 'Streaming ' + sg.letter + ': ' + sg.word + ', ' + sg.pct + ' of a high ' + playTag + ' stream. ' : '') + 'Disc ' + dg.letter + ': ' + dg.pct + ' of a Blu-ray. Rough data grades' + (rankOf(playTag) < RANK['4K'] ? '; some films and shows stream in 4K.' : '.');
    }
    let picMark, picKind = '';
    const picSteps = [];
    const macRoute = !!(pcPic && pcPic.mac && pcPic.mac !== 'any' && pcPic.mac !== b && pcRank > Math.max(rankOf(playTag), rankOf(bestHere)) && (!capRank || capRank < pcRank));
    if (hdUnconfirmed) picMark = 'unk';
    else if (missingHdr) (picMark = 'gap'), (picKind = 'hdr');
    else if (pic === 'lower') {
      picMark = early ? 'try' : 'gap';
      picKind = early ? 'lower-early' : 'lower';
      if (!early) {
        if (shown && topPlay && shown.w < topPlay[0].w * 0.9) picSteps.push('Try full screen; at ' + shown.w + '×' + shown.h + ' the player may pick lower.');
        picSteps.push(svc && svc.name === 'Prime Video' ? 'Check the player’s quality setting (⚙ › Video quality › Best) and your connection.' : 'Check the player’s quality setting and your connection.');
      }
    } else if (macRoute) (picMark = 'gap'), (picKind = 'mac');
    else if (pic === 'belowcap') {
      picMark = 'try';
      picKind = 'belowcap';
      if (!early) picSteps.push('Check your plan, the player’s quality setting and your connection.');
    } else if (pic === 'unknown') picMark = 'unk';
    else if (pcPic && pcPic.complete && rankOf(playTag) >= pcRank && (!/HDR|Dolby Vision/.test(pcPic.best) || isHdr)) picMark = 'ok';
    else picMark = 'top';

    let sndNow, sndCmp = '', sndMark, sndKind = '';
    const sndSteps = [];
    if (snd === 'none') sndNow = 'No sound track';
    else if (snd === 'best') sndNow = aS + ' · ' + (pool.length === 1 ? 'only track sent to ' + B : 'top track sent to ' + B);
    else if (snd === 'known') sndNow = aS;
    else if (snd === 'lower') sndNow = aS + ' · ' + (canBest === true ? S + '’s player chose it over ' + BA : BA + ' also sent' + (canBest === false ? '; ' + B + ' can’t play it' : ''));
    else if (snd === 'cant') sndNow = aS + ' · ' + BA + ' also sent; ' + B + ' can’t play it';
    else sndNow = 'Not reported by ' + B + (BA ? ' · up to ' + BA + ' sent' : '');
    if (snd === 'none') sndMark = '';
    else {
      sndCmp = pcSnd ? pcSnd.cmp : 'Computer best: unknown';
      // The service's player picks the track for this browser and device (an audio menu, if any, picks the language),
      // so a better track it passed over is a fact, not a step.
      if (snd === 'lower' && canBest) sndMark = 'top';
      else if (snd === 'unknown') sndMark = 'unk';
      else if (pcSnd && pcSnd.complete && soundRank(pA) >= soundRank(pcSnd.best)) sndMark = 'ok';
      else sndMark = 'top';
    }

    const limited = b === 'safari' && hz && hz <= 61;
    const dropBad = n >= 240 && p > 2;
    const bufLow = low && !early;
    const uneven = ft && !ft.unknown && !ft.even;
    const hzPart = hz ? 'Page at ' + hz + ' Hz' : '';
    const framePart = ft && ft.unknown ? 'Film frame timing: not reported by ' + B : ft ? (ft.even ? 'even frame timing' : 'uneven frame timing') : '';
    const dropsPart = m.q ? d + ' of ' + t.toLocaleString() + ' frames dropped' : '';
    const joinBits = (xs) => xs.filter(Boolean).join(' · ');
    let pbNow, pbCmp = '', pbMark, pbKind = '';
    const pbSteps = [];
    if (dropBad) {
      pbMark = 'gap';
      pbKind = 'drop';
      pbNow = 'Dropping frames: ' + p.toFixed(1) + '% ' + (when ? 'in the last minute' : 'so far');
      pbCmp = joinBits([hzPart, dropsPart]);
    } else if (bufLow) {
      pbMark = 'gap';
      pbKind = 'buf';
      pbNow = 'Buffer low: ' + Math.round(ahead) + ' s ahead; may stall';
      pbCmp = joinBits([hzPart, dropsPart]);
    } else if (uneven) {
      pbMark = 'gap';
      pbKind = 'uneven';
      pbNow = 'Uneven frame timing; slow pans can judder';
      pbCmp = joinBits([hzPart, dropsPart]);
    } else if (limited) {
      pbMark = 'try';
      pbKind = 'limited';
      pbNow = 'Page at ' + hz + ' Hz; on a 120 Hz screen a Safari setting may hold it back';
      pbCmp = joinBits([framePart, dropsPart]);
      pbSteps.push('Safari › Settings › Advanced › tick “Show features for web developers”', 'Develop › Feature Flags… › untick “Prefer Page Rendering Updates near 60fps”, then reload this page');
    } else if (ft && !ft.unknown && ft.even && hz) {
      pbMark = 'ok';
      pbNow = 'Even frame timing at ' + hz + ' Hz';
      pbCmp = dropsPart;
    } else if (hz || m.q) {
      pbMark = 'top';
      pbNow = joinBits([hzPart, dropsPart]);
    } else {
      pbMark = 'unk';
      pbNow = 'Not measured yet';
    }

    let rows = [
      { part: 'Picture', mark: picMark, now: picNow, note: picNote, cmp: pcPic ? pcPic.cmp : 'Computer best: unknown', steps: picSteps, kind: picKind },
      { part: 'Sound', mark: sndMark, now: sndNow, cmp: sndCmp, steps: sndSteps, kind: sndKind },
      { part: 'Playback', mark: pbMark, now: pbNow, cmp: pbCmp, steps: pbSteps, kind: pbKind },
    ].map((row, i) => ((row.i = i), row));
    const tier = (mark) => (mark === 'gap' ? 0 : mark === 'try' ? 1 : 2);
    rows.sort((a, b) => tier(a.mark) - tier(b.mark) || a.i - b.i);
    const noPc = !pcPic && !pcSnd;
    if (noPc) for (const row of rows) if (row.cmp === 'Computer best: unknown') row.cmp = '';
    const isOverviewIssue = (row) => (row.part === 'Picture' && ['hdr', 'lower', 'lower-early'].includes(row.kind)) || (row.part === 'Playback' && ['drop', 'buf', 'uneven'].includes(row.kind));
    const lead = rows.find(isOverviewIssue) || null;
    let title, sub, pill, dot;
    if (lead && lead.part === 'Picture' && lead.kind === 'hdr') {
      title = 'HDR sent, SDR playing';
      sub = S + ' sent ' + hdrPlayable[0].range + ' at this size, and ' + B + ' can play it. Check the player’s settings for HDR, if it has any.';
    } else if (lead && lead.part === 'Picture' && lead.kind === 'lower-early') {
      title = 'Picture not at top yet';
      sub = 'Playing ' + playTag + '; ' + S + ' sent ' + B + ' up to ' + topTag + '. Players start low; give it a minute.';
    } else if (lead && lead.part === 'Picture' && lead.kind === 'lower') {
      title = 'Picture below ' + topTag;
      sub = 'Playing ' + playTag + '; ' + S + ' sent ' + B + ' up to ' + topTag + '.';
    } else if (lead && lead.part === 'Picture' && lead.kind === 'mac') {
      const sizeWord = (/\b(4K|\d{3,4}p|HD)\b/.exec(pcPic.best) || [])[1] || pcPic.best;
      title = 'Up to ' + sizeWord + ' in ' + pcPic.macName;
      sub = cap ? S + ' caps ' + B + ' at ' + cap + '. Open this film in ' + pcPic.macName + '.' : S + ' offers up to ' + pcPic.best + ' in ' + pcPic.macName + ' on a Mac. Open this film in ' + pcPic.macName + '.';
    } else if (lead && lead.part === 'Picture' && lead.kind === 'belowcap') {
      title = cap + ' possible in ' + B;
      sub = 'Playing ' + playTag + '; ' + S + ' offers ' + B + ' up to ' + cap + ' if the film and plan allow.' + (early ? ' Players start low; give it a minute.' : '');
    } else if (lead && lead.part === 'Playback' && lead.kind === 'drop') {
      title = 'Dropping frames';
      sub = p.toFixed(1) + '% of frames dropped ' + (when ? 'in the last minute' : 'so far') + '; expect stutter.';
    } else if (lead && lead.part === 'Playback' && lead.kind === 'buf') {
      title = 'Buffer running low';
      sub = 'Only ' + Math.round(ahead) + ' s buffered ahead; playback may stall. Check your connection.';
    } else if (lead && lead.part === 'Playback' && lead.kind === 'uneven') {
      title = 'Uneven frame timing';
      sub = 'Frames stay on screen for unequal times (' + ((ft.value.match(/uneven: (.+?) ms/) || [, ''])[1]) + ' ms); slow pans can judder.';
    } else if (lead && lead.part === 'Playback' && lead.kind === 'limited') {
      title = 'Safari page at ' + hz + ' Hz';
      sub = 'Worth trying a Safari setting; steps below.';
    } else if (rows.every((row) => row.mark === 'ok')) {
      title = 'Nothing to change';
      sub = 'Matches the best ' + S + ' publishes for any computer.';
      pill = 'Best for any computer';
      dot = 'ok';
    } else if (rows.find((row) => row.part === 'Picture').mark === 'unk') {
      title = 'Picture unconfirmed';
      sub = hdUnconfirmed ? 'Nothing better found, but ' + S + ' gives no number for its “HD”.' : 'Nothing better found, but the picture can’t be checked against ' + S + '’s stream list.';
      pill = 'Picture unconfirmed';
      dot = 'unk';
    } else {
      title = 'Nothing to change';
      sub = 'Nothing better found for this Mac.';
      pill = 'Nothing to change';
      dot = 'top';
    }
    if (lead) (pill = title), (dot = lead.mark);
    const quiet = [];
    if (noPc) quiet.push(['Computer best:', svc ? 'unknown for ' + S + '.' : 'not on file for ' + S + '.']);
    if (svc && svc.off) quiet.push(['Not on this Mac:', svc.off + '.']);
    if (svc && svc.tv) quiet.push(['Published for TV apps:', svc.tv + '.']);
    quiet.push(['Over the video:', ov.effects.length || ov.parts.length ? ov.effects.concat(ov.parts).join('; ') + '.' : 'nothing found.']);
    const cant = [];
    if (ft && ft.unknown) cant.push('film frame timing (' + B + ' doesn’t report it)');
    cant.push('how ' + B + ' converts the video’s colours for the screen (browsers differ here)');
    cant.push('Movie Sound (it works after the browser)');
    quiet.push(['Can’t tell:', cant.join('; ')]);

    // The overview is current playback, not a catalogue of service/device possibilities.
    // Service ceilings and decoder support alone do not prove a change is available for this title.
    const visibleIssue = lead;
    let gradeReason = '';
    if (!grade) {
      const missing = [];
      if (!(videoBps > 0)) missing.push('video bitrate');
      if (!(fps > 0)) missing.push('frame rate');
      if (!codec) missing.push('video codec');
      gradeReason = missing.length ? 'Needs ' + missing.join(' and ') + '.'
        : / or /.test(codec) ? 'Needs the exact video codec.' : 'No data-grade model for ' + codec + '.';
    }
    let sound = null;
    if (snd === 'none') sound = { value: 'No sound track', meaning: '' };
    else if (pA) {
      const name = pA.name || '', ch = pA.ch;
      if (pA.joc) sound = { value: 'Dolby Atmos', meaning: 'Object-based surround in the stream.' };
      else if (ch && ch.n === 2) sound = { value: 'Stereo', meaning: 'Left and right channels' + (name ? ' · ' + name + ' format' : '') + '.' };
      else if (ch && ch.n === 1) sound = { value: 'Mono', meaning: 'One audio channel' + (name ? ' · ' + name + ' format' : '') + '.' };
      else if (ch && ch.n > 2) sound = { value: ch.label + ' surround', meaning: ch.n + ' encoded channels' + (name ? ' · ' + name + ' format' : '') + '.' };
      else if (name) sound = { value: name + ' audio', meaning: name === 'AAC' ? 'A compressed audio format.' : 'The format of the playing audio track.' };
    }
    const overview = {
      picture: pv,
      pictureNote: ladder && ['top', 'topsize'].includes(pic) ? 'Highest resolution sent for this video.' : '',
      grade, gradeReason, size: playTag, sound,
      issue: visibleIssue ? { title, text: sub, steps: visibleIssue.steps } : null,
      overlay: ov.effects.length || ov.solid ? ov.effects.concat(ov.parts).join('; ') : '',
    };
    // Broader capability statements remain accessible, one disclosure deep.
    const contextRows = rows.filter((row) => row.part !== 'Playback' && row.cmp && !/unknown/.test(row.cmp)).map((row) => [row.part + ' limits', row.cmp, '', 'Published service capability; not confirmed for this title.']);
    if (svc && svc.name === 'Netflix') contextRows.push(['Spatial audio', 'Netflix’s 2-channel spatial mix', '', 'Premium, selected titles; not a macOS setting and not confirmed for this playback.']);
    if (limited) contextRows.push(['Page timing', pbNow, '', 'Page callbacks alone do not establish a video playback problem.']);

    return {
      title: visibleIssue ? title : pv,
      sub: visibleIssue ? sub : '',
      pill: visibleIssue ? title : pv,
      dot: visibleIssue ? visibleIssue.mark : 'top',
      overview,
      kicker: S + ' · ' + B,
      rows,
      quiet,
      sections: [
        { name: 'Picture', rows: pictureRows },
        { name: 'Sound', rows: soundRows },
        { name: 'Playback', rows: playbackRows },
        { name: 'Service context', rows: contextRows },
      ],
    };
  }

  // ---------- the panel ----------

  let host = null, timer = null, panelOpen = false, pillOn = false;
  let lastInput = performance.now(), idleTimer = null;

  // The disclosure is persistent; its content refreshes without replacing the focused control.
  const PANEL_CSS = `
    :host{all:initial;position:fixed;top:12px;right:12px;z-index:2147483647;pointer-events:none;display:flex;flex-direction:column;align-items:flex-end;gap:6px}
    .pill{appearance:none;-webkit-appearance:none;box-sizing:border-box;min-width:44px;min-height:44px;margin:0;padding:0;border:0;background:transparent;color:#f4f5f7;display:flex;align-items:center;justify-content:flex-end;cursor:pointer;transition:opacity .3s}
    .pill[hidden]{display:none}.pill:focus{outline:none}.pill:focus-visible,summary:focus-visible{outline:2px solid #9cc3f5;outline-offset:2px}
    .pv{display:flex;align-items:center;gap:7px;min-height:30px;padding:0 11px;border-radius:15px;background:rgba(23,25,28,.94);border:1px solid #454b54;font:600 12.5px/1.2 "Avenir Next",system-ui,sans-serif;color:#f4f5f7;box-shadow:0 4px 14px #0005}
    .dot{width:7px;height:7px;border-radius:50%;box-sizing:border-box;flex:none;background:#a6adb8}.dot.gap,.dot.try{background:#efbb73}
    .pill,.pill *{pointer-events:auto}:host(.idle) .pill{opacity:0}:host(.idle) .pill,:host(.idle) .pill *{pointer-events:none}
    .p{box-sizing:border-box;width:352px;max-width:calc(100vw - 24px);max-height:calc(100vh - 80px);overflow:auto;padding:16px;border-radius:12px;background:rgba(23,25,28,.97);border:1px solid #454b54;box-shadow:0 12px 32px #0006;color:#f4f5f7;font:13px/1.45 "Avenir Next",-apple-system,system-ui,sans-serif;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased;scrollbar-width:thin;overscroll-behavior:contain}
    .p[hidden]{display:none}.p.scrollable{pointer-events:auto}.p,.p *{pointer-events:none}.p summary,.p summary *{pointer-events:auto;cursor:pointer}.p:has(details[open]),.p:has(details[open]) *{pointer-events:auto}
    .kick{font-size:12px;color:#bfc4cc;margin-bottom:12px}.label{font-size:12px;font-weight:600;color:#bfc4cc}.t{font-size:22px;font-weight:600;line-height:1.25;letter-spacing:-.02em;margin-top:2px}
    .note,.sub{font-size:12px;color:#bfc4cc;margin-top:4px}.grade-area{margin-top:14px}.grades{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:5px}.grade{min-width:0}.grade+.grade{border-left:1px solid #454b54;padding-left:16px}.grade-value{display:block;font-size:22px;font-weight:600;line-height:1.2;margin:3px 0;overflow-wrap:anywhere}.grade-meaning{display:block;font-size:12px;color:#bfc4cc}.grade-percent{display:block;font-size:12px;margin-top:3px}.grade-caveat{font-size:11.5px;color:#a6adb8;margin-top:8px}.grade-reason{color:#bfc4cc;margin-top:3px}
    .sound{margin-top:14px;padding-top:12px;border-top:1px solid #454b54}.sound-value{font-weight:600;font-size:15px;margin-top:2px}.sound .note{margin-top:1px}
    .issue{border-left:2px solid #efbb73;padding-left:10px;margin-top:14px}.issue-title{font-weight:600;color:#efbb73}.issue .note{color:#f4f5f7}.steps{padding-left:17px;font-size:12px;margin:4px 0 0}.steps li{margin:3px 0}
    .more{border-top:1px solid #454b54;margin-top:14px;padding-top:4px}summary{min-height:36px;display:list-item;align-content:center;font-size:12px;font-weight:600;color:#bfc4cc;list-style-position:inside}summary::marker{color:#a6adb8}
    .det{padding-top:4px}.sec{font-size:13px;font-weight:600;color:#f4f5f7;margin:14px 0 5px}.row{display:grid;grid-template-columns:76px minmax(0,1fr);gap:12px;padding:4px 0}.k{font-size:12px;color:#bfc4cc}.v{overflow-wrap:anywhere;min-width:0}.why{display:block;color:#a6adb8;font-size:11.5px;margin-top:2px}.j{display:none}.quiet{font-size:11.5px;color:#a6adb8;margin-top:12px}.quiet div+div{margin-top:5px}.quiet b{color:#bfc4cc;font-weight:600}.f{font-size:11px;color:#a6adb8;margin-top:14px}
    @media(prefers-reduced-motion:reduce){.pill{transition:none}}
  `;

  const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function headHtml(r) {
    if (r.wait || !r.overview) return '<div class="t">' + escHtml(r.title) + '</div>' + (r.sub ? '<div class="sub">' + escHtml(r.sub) + '</div>' : '');
    const o = r.overview;
    const gradeCell = (name, g, meaning, pct) => '<div class="grade"><div class="label">' + name + '</div>' + (g ? '<span class="grade-value">' + escHtml(g.letter) + '</span><span class="grade-meaning">' + escHtml(meaning) + '</span><span class="grade-percent">' + escHtml(g.pct + pct) + '</span>' : '<div class="note">No reference for ' + escHtml(o.size) + '.</div>') + '</div>';
    const gradesHtml = o.grade ? '<div class="grades">' + gradeCell('Streaming', o.grade.stream, o.grade.stream ? o.grade.stream.word : '', ' of a high ' + o.size + ' stream') + gradeCell('Disc', o.grade.disc, 'Against Blu-ray', ' of the Blu-ray reference') + '</div><div class="grade-caveat">Data grades, not a visual test.</div>' : '<div class="grade-reason">' + escHtml(o.gradeReason) + '</div>';
    const sound = o.sound ? '<div class="sound"><div class="label">Sound</div><div class="sound-value">' + escHtml(o.sound.value) + '</div>' + (o.sound.meaning ? '<div class="note">' + escHtml(o.sound.meaning) + '</div>' : '') + '</div>' : '';
    const issue = o.issue ? '<div class="issue"><div class="issue-title">' + escHtml(o.issue.title) + '</div><div class="note">' + escHtml(o.issue.text) + '</div>' + (o.issue.steps && o.issue.steps.length ? '<ul class="steps">' + o.issue.steps.map(x => '<li>' + escHtml(x) + '</li>').join('') + '</ul>' : '') + '</div>' : '';
    const overlay = o.overlay ? '<div class="issue"><div class="issue-title">Picture altered by the page</div><div class="note">' + escHtml(o.overlay) + '</div></div>' : '';
    return '<div class="kick">' + escHtml(r.kicker) + '</div><div class="label">Picture</div><div class="t">' + escHtml(o.picture) + '</div>' + (o.pictureNote ? '<div class="note">' + escHtml(o.pictureNote) + '</div>' : '') + '<div class="grade-area"><div class="label">Data grades</div>' + gradesHtml + '</div>' + sound + issue + overlay;
  }

  function detHtml(r) {
    const row = ([k, v, lv, why]) => '<div class="row"><div class="k">' + escHtml(k) + '</div><div class="v">' + escHtml(v) + (why ? '<span class="why">' + escHtml(why) + '</span>' : '') + '</div></div>';
    const sections = (r.sections || []).map(s => ({ ...s, rows: (s.rows || []).filter(x => x[1] && !['not reported', 'measuring…', '—'].includes(x[1])) })).filter(s => s.rows.length).map(s => '<div class="sec">' + escHtml(s.name) + '</div>' + s.rows.map(row).join('')).join('');
    const context = r.quiet && r.quiet.length ? '<div class="quiet">' + r.quiet.map(([k,v]) => '<div><b>' + escHtml(k) + '</b> ' + escHtml(v) + '</div>').join('') + '</div>' : '';
    return sections + context + '<div class="f">Control+Shift+H opens and closes this panel.</div>';
  }

  function build() {
    host = document.createElement('div');
    host.setAttribute('data-stream-quality-hud', '');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>' + PANEL_CSS + '</style>' +
      '<button class="pill" type="button" aria-expanded="false" aria-controls="p"><span class="pv"><span class="dot"></span><span class="pt"></span></span></button>' +
      '<div class="p" id="p" hidden><div class="head"></div><details class="more"><summary>Technical details</summary><div class="det"></div></details></div>';
    // The disclosure itself is never rebuilt; focus remains on the same summary.
    root.querySelector('details').addEventListener('toggle', () => {
      const p = root.querySelector('.p');
      p.classList.toggle('scrollable', p.scrollHeight > p.clientHeight);
    });
    root.querySelector('.pill').addEventListener('click', (e) => {
      setPanel(!panelOpen);
      if (e.detail > 0) e.currentTarget.blur();
    });
  }

  function pillWanted() {
    if (!document.querySelector('video')) return false;
    const video = mainVideo();
    return !!(video && video.videoWidth > 0 && (currentService() || !isFinite(video.duration) || video.duration >= 600));
  }

  function leaveHost() {
    if (host && host.isConnected) host.remove();
    clearInterval(timer);
    timer = null;
    clearTimeout(idleTimer);
    idleTimer = null;
    samples.length = 0;
    drops.length = 0;
    setTiming(false);
  }

  function ensureHost() {
    pillOn = pillWanted();
    if (!pillOn && !panelOpen) {
      if (host && host.isConnected) leaveHost();
      return;
    }
    if (!host) build();
    if (!host.isConnected) {
      placeHost();
      setTiming(true);
      if (!timer) timer = setInterval(() => {
        ensureHost();
        if (host && host.isConnected) render();
      }, 1000);
    }
  }

  function updateIdle() {
    if (!host || !host.isConnected) return;
    const video = mainVideo();
    const pill = host.shadowRoot.querySelector('.pill');
    const focused = !!(pill && host.shadowRoot.activeElement === pill);
    const hovered = !!(pill && pill.matches(':hover'));
    if (panelOpen || !video || video.paused || focused || hovered || !pillOn) {
      host.classList.remove('idle');
      return;
    }
    if (performance.now() - lastInput >= 3000) host.classList.add('idle');
  }

  function render() {
    if (!host || !host.isConnected) return;
    placeHost();
    pillOn = pillWanted();
    if (!pillOn && !panelOpen) {
      leaveHost();
      return;
    }
    let r;
    try {
      r = report();
    } catch (e) {
      r = { wait: true, title: 'Couldn\u2019t read the video', sub: String((e && e.message) || e), pill: 'Couldn\u2019t read the video', dot: 'unk', sections: [] };
    }
    const root = host.shadowRoot;
    const pill = root.querySelector('.pill');
    const text = r.pill || r.title || '';
    pill.hidden = !pillOn;
    root.querySelector('.pt').textContent = text;
    root.querySelector('.dot').className = 'dot' + (r.dot ? ' ' + r.dot : '');
    pill.setAttribute('aria-expanded', panelOpen ? 'true' : 'false');
    pill.setAttribute('aria-label', 'Stream quality: ' + text + (panelOpen ? '. Hide panel' : '. Show panel'));
    root.querySelector('.p').hidden = !panelOpen;
    const panel = root.querySelector('.p');
    const scroll = panel.scrollTop;
    root.querySelector('.head').innerHTML = headHtml(r);
    root.querySelector('.det').innerHTML = detHtml(r);
    panel.scrollTop = scroll;
    panel.classList.toggle('scrollable', panel.scrollHeight > panel.clientHeight);
    updateIdle();
  }

  // No absent diagnostic is retained as a blank placeholder. Normal flow keeps all facts reachable.

  // In full screen only the full-screen element is drawn, so the pill and panel move inside it together.
  // (When a site puts the bare <video> itself in full screen, nothing can be drawn over it.)
  function placeHost() {
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    const parent = fs && fs.tagName !== 'VIDEO' ? fs : document.documentElement;
    if (host && host.parentNode !== parent) parent.appendChild(host);
  }

  // The panel lives in the frame that holds the video; a top page without one shows "no video"
  // only when it has no frames that might.
  const wantsPanel = () => !!document.querySelector('video') || (window === window.top && !document.querySelector('iframe, frame'));

  function setPanel(open) {
    if (open && !wantsPanel()) open = false;
    panelOpen = !!open;
    ensureHost();
    if (host && host.isConnected) render();
  }

  // The key toggles this frame's panel directly when it holds the video. Otherwise (a top page whose
  // player is in an iframe) it asks the background, which asks every frame whether a panel is showing
  // and then shows or hides it everywhere, just as the toolbar button does.
  function requestToggle() {
    const local = () => setPanel(!panelOpen);
    if (wantsPanel()) return local();
    try {
      chrome.runtime.sendMessage({ type: 'sqhud-toggle-request' }, (reply) => {
        void chrome.runtime.lastError;
        if (!reply || !reply.ok) local();
      });
    } catch (e) {
      local();
    }
  }

  function noteInput() {
    lastInput = performance.now();
    if (host) host.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = host && host.isConnected ? setTimeout(updateIdle, 3000) : null;
  }
  document.addEventListener('pointermove', noteInput, { capture: true, passive: true });
  document.addEventListener('keydown', noteInput, { capture: true, passive: true });
  document.addEventListener('fullscreenchange', () => { if (host && host.isConnected) placeHost(); });
  document.addEventListener('webkitfullscreenchange', () => { if (host && host.isConnected) placeHost(); });

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.code === 'KeyH' && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        requestToggle();
      }
    },
    true
  );

  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === 'sqhud-set') setPanel(!!msg.show);
      if (msg && msg.type === 'sqhud-state' && panelOpen) sendResponse({ shown: true });
      return false;
    });
  } catch (e) {}

  // While the pill is not on the page, look every 2 seconds, and as soon as a video has a frame.
  function probe() {
    if (host && host.isConnected) return;
    const video = document.querySelector('video');
    if (!video) return;
    if (!pillWanted()) return;
    ensureHost();
    if (host && host.isConnected) render();
  }
  setInterval(probe, 2000);
  document.addEventListener('loadeddata', probe, true);
  document.addEventListener('playing', probe, true);
})();
