// Offline G1–G7 regressions: synthetic counters and intercepted HTML only; no fixture servers.
import { chromium, webkit } from 'playwright-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../extension/hud.js', import.meta.url), 'utf8');
let count = 0;
for (const [name, engine] of [['Chromium', chromium], ['WebKit', webkit]]) {
  const browser = await engine.launch({ headless: true });
  try {
    const ctx = await browser.newContext();
    await ctx.route('**/*', route => {
      const u = new URL(route.request().url());
      const body = u.pathname === '/relay' ? '<iframe src="https://player.test/middle"></iframe>'
        : u.pathname === '/middle' ? '<iframe src="https://media.test/leaf"></iframe>'
        : u.pathname === '/product' || u.pathname === '/gp/video/detail/test' ? '<iframe src="/leaf"></iframe>'
        : u.pathname === '/unknown' ? '<iframe src="https://player.test/leaf"></iframe>'
        : '<video style="width:640px;height:360px"></video>';
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html>' + body });
    });
    const instrument = 'window.__now=1000;\n' + source.replaceAll('performance.now()', 'window.__now').replace(/\}\)\(\);\s*$/, `
      frameTiming=()=>null; refreshHz=()=>null; watchFrames=()=>{};
      window.__hud={measure,sessionStart,currentService,report,addLists,ladders,ensureHost,render,updateIdle,setPanel,
        state:()=>({panelOpen,pillOn,lastInput,idle:!!host&&host.classList.contains('idle')}),
        close:()=>{panelOpen=false;leaveHost()}, noService:()=>{currentService=()=>null}};
    })();`);
    await ctx.addInitScript({ content: instrument });
    const page = await ctx.newPage();
    const check = (label, yes) => { assert.ok(yes, name + ': ' + label); count++; console.log('PASS ' + name + ': ' + label); };
    await page.goto('https://www.netflix.com/test');
    const measurements = await page.evaluate(() => {
      const v = document.querySelector('video'), h = __hud;
      const state = { paused: false, playbackRate: 1, currentSrc: 'a', webkitVideoDecodedByteCount: 0, webkitAudioDecodedByteCount: 0 };
      let frames = 0;
      for (const k of Object.keys(state)) Object.defineProperty(v, k, { configurable: true, get: () => state[k] });
      v.getVideoPlaybackQuality = () => ({ totalVideoFrames: frames, droppedVideoFrames: 0 });
      const tick = (t, seconds = 0) => {
        __now = t * 1000;
        state.webkitVideoDecodedByteCount += seconds * 500000;
        state.webkitAudioDecodedByteCount += seconds * 16000;
        frames += seconds * 24 * state.playbackRate;
        return h.measure(v);
      };
      tick(1); tick(2, 1); const playing = tick(3, 1);
      state.paused = true; v.dispatchEvent(new Event('pause')); const paused = tick(4);
      tick(8); state.paused = false; v.dispatchEvent(new Event('playing')); const resume = tick(9);
      tick(10, 1); const fresh = tick(11, 1);
      // A whole pause/resume between reports must also break the measurement window.
      v.dispatchEvent(new Event('pause')); v.dispatchEvent(new Event('playing')); const briefPause = tick(12);
      tick(13, 1); tick(14, 1); state.playbackRate = 2; v.dispatchEvent(new Event('ratechange')); const rateChange = tick(15);
      tick(16, 1); const double = tick(17, 1);
      state.paused = true; state.currentSrc = 'b'; const newSource = tick(18);
      state.currentSrc = 'a'; h.sessionStart.set(v, 99); const newSession = tick(19);
      state.paused=false; tick(20); tick(21,1); tick(22,1);
      state.webkitVideoDecodedByteCount=0; state.webkitAudioDecodedByteCount=0; frames=0;
      const counterReset=tick(23);
      state.paused=true; const pausedAfterReset=tick(24);
      const other=document.createElement('video'); const switched=h.measure(other);
      return { playing, paused, resume, fresh, briefPause, rateChange, double, newSource, newSession, counterReset, pausedAfterReset, switched };
    });
    check('G1 continuous 4 Mbps, 128 kbps, 24 fps', measurements.playing.rate === 4000000 && measurements.playing.arate === 128000 && measurements.playing.fps === 24);
    check('G1 pause retains known metrics', measurements.paused.rate === 4000000 && measurements.paused.arate === 128000 && measurements.paused.fps === 24);
    check('G1 resume excludes paused wall time', measurements.resume.rate === null && measurements.fresh.rate === 4000000);
    check('G1 pause between reports resets window', measurements.briefPause.rate === null);
    check('G1 speed boundary resets and normalizes fps', measurements.rateChange.rate === null && measurements.double.fps === 24);
    check('G1 paused source/session changes cannot retain old rates', [measurements.newSource, measurements.newSession].every(m => m.rate === null && m.arate === null && m.fps === null));
    check('G1 counter reset and video switch discard old rates', [measurements.counterReset, measurements.pausedAfterReset, measurements.switched].every(m => m.rate === null && m.arate === null && m.fps === null));
    await page.reload();
    await page.evaluate(() => {
      const v = document.querySelector('video');
      window.__cfg = { codec: 'hvc1.1.6.L120', framerate: 24, bitrate: 6000000 };
      window.__duration = 1200; window.__src = ''; window.__height = 1080;
      for (const [k, get] of Object.entries({ paused: () => false, videoWidth: () => 1920, videoHeight: () => __height,
        currentSrc: () => __src, videoTracks: () => [{ selected: true, configuration: __cfg }],
        duration: () => __duration, currentTime: () => 100, buffered: () => ({length:1,start:()=>0,end:()=>102}) }))
        Object.defineProperty(v, k, { configurable: true, get });
      __hud.report(); __now = 121000;
    });
    const row = (section, label) => page.evaluate(([section, label]) => __hud.report().sections.find(s => s.name === section).rows.find(r => r[0] === label), [section, label]);
    check('G2 HEVC diagnostic uses adjusted 0.193', /0\.193 bits per pixel/.test((await row('Picture', 'Disc grade'))[3]));
    await page.evaluate(() => { __height = 720; __cfg = {codec:'avc1.640028',framerate:24,bitrate:3000000}; Object.defineProperty(document.querySelector('video'),'videoWidth',{configurable:true,get:()=>1280}); });
    check('G2 720p diagnostic uses size-adjusted 0.111', /0\.111 bits per pixel/.test((await row('Picture', 'Disc grade'))[3]));
    await page.evaluate(() => { __height = 1080; Object.defineProperty(document.querySelector('video'),'videoWidth',{configurable:true,get:()=>1920}); __cfg={codec:'avc1.640028'}; __src='https://www.netflix.com/test.m3u8'; });
    for (const [rates, expected] of [[[0,24],false],[[24,0],false],[[24,24],true],[[24,30],false]]) {
      await page.evaluate(rates => {
        __hud.ladders.length=0;
        __hud.addLists('#EXTM3U\n'+rates.map((fps,i)=>'#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,CODECS="avc1.640028"'+(fps?',FRAME-RATE='+fps:'')+'\n'+i+'.m3u8\n').join(''),__src);
      }, rates);
      check('G3 candidate fps '+rates+' remains '+(expected?'known':'uncertain'), !!(await row('Playback','Frame rate')) === expected);
    }
    await page.evaluate(() => { __now+=120000; __duration=Infinity; });
    check('G4 live two-second buffer is normal', (await row('Playback','Buffered'))[2] === 'normal');
    await page.evaluate(() => { __duration=1200; });
    check('G4 finite VOD two-second buffer still warns', (await row('Playback','Buffered'))[2] === 'unusual');
    await page.evaluate(() => { __duration=103; });
    check('G4 finite VOD near end is exempt', (await row('Playback','Buffered'))[2] === 'normal');
    await page.evaluate(() => { __duration=NaN; });
    check('G4 unknown duration is exempt', (await row('Playback','Buffered'))[2] === 'normal');
    await page.evaluate(() => { __hud.noService(); __duration=1200; __now=400000; __hud.ensureHost(); __hud.render(); });
    check('G7 delayed first connection starts visible', !(await page.evaluate(()=>__hud.state().idle)));
    await page.evaluate(() => { __now+=3001; __hud.updateIdle(); });
    check('G7 pill fades after three seconds', await page.evaluate(()=>__hud.state().idle));
    await page.evaluate(() => { __duration=100; __hud.setPanel(true); __hud.render(); __now+=5000; __duration=1200; __hud.setPanel(false); });
    check('G7 pill onset resets idle clock', await page.evaluate(()=>!__hud.state().idle && __hud.state().lastInput===__now));
    await page.evaluate(() => { __hud.close(); __now+=5000; __hud.ensureHost(); __hud.render(); });
    check('G7 host reconnect resets idle clock', !(await page.evaluate(()=>__hud.state().idle)));
    for (const [path, expected] of [['/product',null],['/gp/video/detail/test','Prime Video'],['/unknown',null]]) {
      await page.goto('https://www.amazon.com'+path);
      const child = page.frames()[1];
      await child.waitForFunction(()=>!!window.__hud);
      check('G5 Amazon frame '+path, await child.evaluate(()=>__hud.currentService()?.name || null) === expected);
    }
    await page.goto('https://www.primevideo.com/detail/test');
    check('G5 Prime Video own domain needs no Amazon path', await page.evaluate(()=>__hud.currentService()?.name) === 'Prime Video');
    await page.goto('https://outer.test/relay');
    const leaf = page.frames().find(f=>f.url()==='https://media.test/leaf');
    await leaf.waitForFunction(()=>!!window.__hud);
    await page.keyboard.press('Control+Shift+KeyH');
    await leaf.waitForFunction(()=>__hud.state().panelOpen);
    check('G6 top userscript key reaches nested cross-origin video', await leaf.evaluate(()=>__hud.state().panelOpen));
    await leaf.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{source:window.top,data:{type:'sqhud-descendant-toggle'}})));
    check('G6 rejects a non-parent sender', await leaf.evaluate(()=>__hud.state().panelOpen));
    await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{source:window.frames[0],data:{type:'sqhud-descendant-toggle'}})));
    check('G6 top rejects a child sender', await leaf.evaluate(()=>__hud.state().panelOpen));
    await page.keyboard.press('Control+Shift+KeyH');
    await leaf.waitForFunction(()=>!__hud.state().panelOpen);
    check('G6 repeated top key hides nested panel', !(await leaf.evaluate(()=>__hud.state().panelOpen)));
    const extCtx=await browser.newContext();
    await extCtx.route('**/*',route=>route.fulfill({contentType:'text/html',body:route.request().url().endsWith('/leaf')?'<!doctype html><video></video>':'<!doctype html><iframe src="https://extension-child.test/leaf"></iframe>'}));
    await extCtx.addInitScript({content:`window.__sent=[];window.chrome={runtime:{id:'synthetic-extension',lastError:null,onMessage:{addListener:fn=>window.__listener=fn},sendMessage:(msg,cb)=>{__sent.push(msg);cb({ok:true})}}};`+instrument});
    const extPage=await extCtx.newPage();await extPage.goto('https://extension.test/');
    const extLeaf=extPage.frames()[1];await extLeaf.waitForFunction(()=>!!window.__hud);
    await extPage.keyboard.press('Control+Shift+KeyH');
    check('G6 extension top key still requests background toggle',await extPage.evaluate(()=>__sent.length===1&&__sent[0].type==='sqhud-toggle-request'));
    await extLeaf.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{source:window.parent,data:{type:'sqhud-descendant-toggle'}})));
    check('G6 extension ignores userscript relay even from parent',!(await extLeaf.evaluate(()=>__hud.state().panelOpen)));
    await extLeaf.evaluate(()=>__listener({type:'sqhud-set',show:true},{},()=>{}));
    check('G6 extension background set message still opens frame panel',await extLeaf.evaluate(()=>__hud.state().panelOpen));
    await extCtx.close();
  } finally { await browser.close(); }
}
console.log(`${count}/${count} accepted-fix checks passed`);
