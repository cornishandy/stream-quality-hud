// Presentation/evidence regressions. Synthetic silent playback, deterministic track/metric evidence;
// hook-only rewrites follow run.mjs timingChecks and never ship in the extension.
import {chromium, webkit} from 'playwright-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../extension/hud.js',import.meta.url),'utf8');
const out=process.env.HUD_SHOTS || '/Users/andrewphillips/Library/Caches/hud-design';
let count=0;
const check=(label,yes)=>{assert.ok(yes,label);count++;console.log('PASS '+label)};
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 const browser=await engine.launch({headless:true,args:engine===chromium?['--mute-audio']:[]});
 try{
  const ctx=await browser.newContext({viewport:{width:1280,height:800}});
  await ctx.route('https://www.netflix.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{background:#08090b;margin:0}video{width:100%;height:700px}</style><video muted></video>'}));
  await ctx.addInitScript({content:source.replace('function render() {','function render() { window.__renderTicks=(window.__renderTicks||0)+1;').replace('const m = measure(video);','const m = window.__metrics;').replace(/\}\)\(\);\s*$/,`
    frameTiming=()=>null;refreshHz=()=>120;watchFrames=()=>{};
    window.__hud={report,render,setPanel,addLists,ladders,canPlayVideo};
  })();`)});
  const page=await ctx.newPage(); await page.goto('https://www.netflix.com/watch/synthetic');
  await page.evaluate(()=>{
   window.__metrics={playingFor:120,fps:0,rate:0,arate:0};
   window.__vc={codec:'avc1.640028',framerate:24,bitrate:0,colorSpace:{transfer:'bt709'}};
   window.__ac={codec:'mp4a.40.2',numberOfChannels:2,sampleRate:48000};
   const v=document.querySelector('video');
   for(const [key,get] of Object.entries({currentSrc:()=>window.__manifestSrc||'',videoWidth:()=>window.__width||3840,videoHeight:()=>window.__height||2160,videoTracks:()=>[{selected:true,configuration:window.__vc}],audioTracks:()=>window.__ac?[{enabled:true,configuration:window.__ac}]:undefined}))Object.defineProperty(v,key,{configurable:true,get});
   window.__hud.setPanel(true);
  });
  const head=()=>page.evaluate(()=>document.querySelector('[data-stream-quality-hud]').shadowRoot.querySelector('.head').innerText);
  const exportState=async(kind)=>fs.writeFileSync(out+'/'+name.toLowerCase()+'-'+kind+'-render.json',JSON.stringify(await page.evaluate(()=>{const r=document.querySelector('[data-stream-quality-hud]').shadowRoot;return {css:r.querySelector('style').textContent,head:r.querySelector('.head').innerHTML,det:r.querySelector('.det').innerHTML}})));
  let t=await head();
  check(name+' low-evidence grades have a visible reason',/Data grades\s+Needs video bitrate\./.test(t));
  check(name+' observed stereo explained without inaccessible options',/Stereo\s+Left and right channels · AAC format/.test(t)&&!/best|Atmos|spatial|Orion|Nothing to change|Playback|Movie Sound/.test(t));
  await page.locator('[data-stream-quality-hud]').screenshot({path:out+'/'+name.toLowerCase()+'-netflix-main.png'});await exportState('netflix');
  await page.evaluate(()=>{window.__ac={codec:'mp4a.40.2'};window.__hud.render()});t=await head();
  check(name+' AAC alone does not imply stereo',/AAC audio/.test(t)&&!/Stereo|channels/.test(t));
  await page.evaluate(()=>{window.__ac=null;window.__hud.render()});t=await head();
  check(name+' unreported audio leaves no empty sound row',!/Sound|Not reported|Unknown/.test(t));
  await page.evaluate(()=>{window.__vc={};window.__hud.render()});t=await head();
  check(name+' grade reason names missing codec and frame rate',/video bitrate and frame rate and video codec/.test(t));
  await page.evaluate(()=>{window.__width=1920;window.__height=1080;window.__vc={codec:'avc1.640028',bitrate:6000000,framerate:24,colorSpace:{transfer:'bt709'}};window.__ac={codec:'mp4a.40.2',numberOfChannels:2};window.__hud.render()});t=await head();
  check(name+' both grades and comparisons are directly visible',/Streaming\s+C\s+moderate data\s+about 50%/.test(t)&&/Disc\s+C\s+Against Blu-ray\s+about 20%/.test(t)&&/Data grades, not a visual test/.test(t));
  await page.locator('[data-stream-quality-hud]').screenshot({path:out+'/'+name.toLowerCase()+'-graded-main.png'});await exportState('graded');
  await page.evaluate(()=>{window.__width=2560;window.__height=1440;window.__hud.render()});t=await head();
  check(name+' absent streaming reference preserves disc comparison',/No reference for 1440p/.test(t)&&/Disc\s+[ABCDF]/.test(t));
  await page.evaluate(()=>{window.__vc.codec='zzzz';window.__hud.render()});t=await head();
  check(name+' unsupported codec explains grade absence',/No data-grade model for zzzz/.test(t));
  await page.evaluate(()=>{window.__vc.codec='';window.__hud.render()});t=await head();
  check(name+' losing codec evidence removes stale letters',/Needs video codec/.test(t)&&!/grade-value/.test(await page.locator('[data-stream-quality-hud]').evaluate(h=>h.shadowRoot.querySelector('.head').innerHTML)));
  await page.evaluate(()=>{window.__vc.codec='avc1.640028';window.__hud.render()});
  for(const height of [400,500,600]){
   await page.setViewportSize({width:360,height});await page.evaluate(()=>window.__hud.render());
   const at=await page.evaluate(()=>{const r=document.querySelector('[data-stream-quality-hud]').shadowRoot,p=r.querySelector('.p'),s=r.querySelector('summary');p.scrollTop=p.scrollHeight;const b=s.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2,inside:b.top>=0&&b.bottom<=innerHeight,wide:p.scrollWidth<=p.clientWidth}});
   check(name+' '+height+'px all content fits or scrolls, no horizontal overflow',at.inside&&at.wide);
   await page.mouse.click(at.x,at.y);check(name+' '+height+'px physical Details click works',await page.evaluate(()=>document.querySelector('[data-stream-quality-hud]').shadowRoot.querySelector('details').open));
   const stable=await page.evaluate(()=>{const r=document.querySelector('[data-stream-quality-hud]').shadowRoot,p=r.querySelector('.p'),s=r.querySelector('summary');s.focus();p.scrollTop=p.scrollHeight;const before=p.scrollTop;window.__hud.render();return {before,after:p.scrollTop,focused:r.activeElement===s}});
   check(name+' '+height+'px refresh preserves focus and bottom scroll',stable.focused&&Math.abs(stable.before-stable.after)<1);
   await page.evaluate(()=>document.querySelector('[data-stream-quality-hud]').shadowRoot.querySelector('summary').click());
  }
  // Regression for issue1: two natural timer renders, not an explicit call to render().
  await page.setViewportSize({width:360,height:400});
  await page.evaluate(()=>{window.__hud.render();document.querySelector('[data-stream-quality-hud]').shadowRoot.querySelector('details').open=true});
  for(const fraction of [0.5,1]){
   const before=await page.evaluate(fraction=>{const r=document.querySelector('[data-stream-quality-hud]').shadowRoot,p=r.querySelector('.p');p.scrollTop=(p.scrollHeight-p.clientHeight)*fraction;const b=p.getBoundingClientRect();return {scroll:p.scrollTop,height:p.scrollHeight,top:b.top,box:b.height,ticks:window.__renderTicks}},fraction);
   await page.waitForFunction(ticks=>window.__renderTicks>=ticks+2,before.ticks,{timeout:4000});
   const after=await page.evaluate(()=>{const p=document.querySelector('[data-stream-quality-hud]').shadowRoot.querySelector('.p'),b=p.getBoundingClientRect();return {scroll:p.scrollTop,height:p.scrollHeight,top:b.top,box:b.height}});
   check(name+' two natural refreshes keep '+(fraction===1?'bottom':'middle')+' and panel geometry',Math.abs(before.scroll-after.scroll)<=2&&before.height===after.height&&before.top===after.top&&before.box===after.box);
  }
  await page.evaluate(()=>document.querySelector('[data-stream-quality-hud]').shadowRoot.querySelector('details').open=false);
  await page.setViewportSize({width:1280,height:800});await page.evaluate(()=>{window.__width=1920;window.__height=1080;window.__hud.render()});
  await page.locator('[data-stream-quality-hud]').evaluate(h=>h.shadowRoot.querySelector('summary').focus());await page.keyboard.press('Enter');
  check(name+' keyboard opens technical disclosure',await page.evaluate(()=>document.querySelector('[data-stream-quality-hud]').shadowRoot.querySelector('details').open));
  const text=await page.evaluate(()=>document.querySelector('[data-stream-quality-hud]').shadowRoot.querySelector('.det').innerText);
  check(name+' no stale/blank diagnostics or Orion footnote',!/nothing to show|measuring…|Orion|^—$/m.test(text));
  await page.locator('[data-stream-quality-hud]').screenshot({path:out+'/'+name.toLowerCase()+'-details.png'});
  for(const [codec,label] of [['','unknown'],['vvc1.1.L153.B0','unsupported']]){
   const r=await page.evaluate(codec=>{const h=window.__hud;h.ladders.length=0;window.__manifestSrc='https://www.netflix.com/check.m3u8';h.addLists('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,FRAME-RATE=24,VIDEO-RANGE=PQ'+(codec?',CODECS="'+codec+'"':'')+'\nhdr.m3u8\n',window.__manifestSrc);h.render();const report=h.report();return {cap:h.canPlayVideo(codec),colour:report.sections.find(s=>s.name==='Picture').rows.find(r=>r[0]==='Colour'),main:document.querySelector('[data-stream-quality-hud]').shadowRoot.querySelector('.head').innerText}},codec);
   check(name+' HDR '+label+' capability retains its evidence state',label==='unknown' ? r.cap===null&&/codec support not reported/.test(r.colour[3])&&!/HDR sent, SDR playing/.test(r.main) : r.cap===false&&/codec .* lacks/.test(r.colour[3]));
  }
  await page.evaluate(()=>{window.__manifestSrc='';window.__hud.ladders.length=0;window.__hud.render()});
  // Export actual renderer/CSS output, not a separately recreated visual mock.
  const markup=await page.evaluate(()=>{const r=document.querySelector('[data-stream-quality-hud]').shadowRoot;r.querySelector('details').open=false;return {css:r.querySelector('style').textContent,head:r.querySelector('.head').innerHTML,det:r.querySelector('.det').innerHTML}});
  fs.writeFileSync(out+'/'+name.toLowerCase()+'-render.json',JSON.stringify(markup));
 }finally{await browser.close()}
}
console.log(count+'/'+count+' overview checks passed');
