import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const { loadPlaywright, serve, PLATFORM_NAMES } = await import(pathToFileURL(path.resolve(process.env.IBIS_SOURCE ?? '.', 'scripts/gallery-contact-sheet.mjs')).href);
const root = path.resolve(process.argv[2] ?? '.');
const browser=await(await loadPlaywright()).chromium.launch({headless:true});
const servers=await Promise.all([
  serve(path.join(root, 'base-dist')),
  serve(path.join(root, 'after-dist')),
]);
const origins=servers.map(s=>`http://127.0.0.1:${s.address().port}`);
const results=[], issues=[];
const profiles=[];
for(const platform of ['macos','windows','linux'])for(const theme of ['light','dark'])for(const width of [360,420,720,1120])for(const text of ['normal','large','200'])profiles.push({platform,theme,mode:'normal',width,text});
async function observe(origin,p,state) {
 const context=await browser.newContext({viewport:{width:p.width,height:480},colorScheme:p.theme,reducedMotion:'reduce',contrast:p.mode==='more'?'more':'no-preference',forcedColors:p.mode==='forced'?'active':'none'});
 const page=await context.newPage();
 await page.addInitScript(()=>{Date.now=()=>Date.parse('2026-10-22T09:00:00Z');});
 await page.addInitScript(platform=>Object.defineProperty(navigator,'platform',{configurable:true,get:()=>platform}),PLATFORM_NAMES[p.platform]);
 await page.mouse.move(-1,-1);
 await page.goto(`${origin}/gallery.html?${new URLSearchParams({state,platform:p.platform,theme:p.mode==='gallery'?'contrast':p.theme,text:p.text==='200'?'normal':p.text})}`);
 await page.waitForFunction(id=>document.documentElement.dataset.galleryRendered===id,state);
 await page.evaluate(async p=>{
  if(p.text==='200')document.documentElement.style.fontSize='200%';
  await document.fonts.ready;
  for(let i=0;i<6;i++)await new Promise(requestAnimationFrame);
  if(p.mode==='gallery')document.documentElement.dataset.galleryTheme='contrast';
  if(p.mode==='native'||p.mode==='reduced')document.documentElement.dataset.nativeAppearance=p.platform==='macos'?'vibrancy':'mica';
  if(p.mode==='reduced'){
    // Chromium has no Playwright reduced-transparency switch. Activate the
    // real reduce rules and deactivate the real no-preference rules via CSSOM.
    const visit=owner=>{for(const r of [...owner.cssRules]){if(r.type===4&&r.conditionText.includes('prefers-reduced-transparency')) {
      r.media.mediaText=r.conditionText.replace('(prefers-reduced-transparency: reduce)','all').replace('(prefers-reduced-transparency: no-preference)','not all');
    } if(r.cssRules)visit(r);}};
    for(const sheet of document.styleSheets)visit(sheet);
  }
 },p);
 const facts=await page.evaluate(()=>{
  const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
  const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  const css=e=>{const s=getComputedStyle(e);return {color:s.color,bg:s.backgroundColor,shadow:s.boxShadow,radius:s.borderRadius,outline:s.outline,transition:s.transitionDuration,position:s.position,zIndex:s.zIndex};};
  const surfaces=[document.documentElement,...document.querySelectorAll('.search-bar,.results-area,.shelf,.shelf-output,.shelf-chips,[role="option"][data-active],footer kbd,.setup-choices,.writing-choice,.suggested-action')].filter(visible).map(e=>({tag:e.className||e.id||e.tagName,...css(e),box:box(e)}));
  const geometry=[...document.querySelectorAll('main,.search-bar,.results-area,.shelf,.shelf-output,.shelf-chips,[role="option"],footer,.toolbar-menu-button,.writing-choice')].filter(visible).map(e=>({tag:e.className||e.id||e.tagName,box:box(e)}));
  const rgba=value=>{const canvas=document.createElement('canvas'),c=canvas.getContext('2d');c.fillStyle=value;c.fillRect(0,0,1,1);return [...c.getImageData(0,0,1,1).data];};
  const over=(fg,bg)=>fg.slice(0,3).map((c,i)=>c*fg[3]/255+bg[i]*(1-fg[3]/255));
  const luminance=rgb=>rgb.map(c=>c/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((a,c,i)=>a+c*[.2126,.7152,.0722][i],0);
  const ratios=[]; let index=0;
  for(const e of document.querySelectorAll('main *')){
   if(!visible(e)||e.closest('.visually-hidden,[aria-hidden="true"]')||![...e.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim()))continue;
   const s=getComputedStyle(e);if(s.backgroundImage!=='none')continue; index++;
   const chain=[];for(let a=e;a;a=a.parentElement)chain.unshift(a);
   for(const backdrop of [0,120,141,255]){
    let bg=[backdrop,backdrop,backdrop];for(const a of chain)bg=over(rgba(getComputedStyle(a).backgroundColor),bg);
    const fg=over(rgba(s.color),bg),ls=[luminance(fg),luminance(bg)].sort((a,b)=>b-a),ratio=(ls[0]+.05)/(ls[1]+.05);
    const exception=!!e.closest('[role="option"][data-active],.suggested-action,.writing-choice[aria-pressed="true"],button:disabled,button[aria-disabled="true"]');
    ratios.push({index,tag:e.className||e.tagName,ratio,backdrop,exception});
   }
  }
  return {surfaces,geometry,ratios,overflow:document.documentElement.scrollWidth>innerWidth};
 });
 await context.close();return facts;
}
try{
 for(const p of profiles)for(const state of ['many-results','first-run-found','tray-preview']){
  const before=await observe(origins[0],p,state),after=await observe(origins[1],p,state);
  assert.deepEqual(after.geometry,before.geometry,JSON.stringify({p,state,check:'geometry'}));
  assert.equal(after.overflow,before.overflow);
  for(const s of after.surfaces)assert.equal(s.transition,'0s',JSON.stringify({p,state,s}));
  if(['more','forced','gallery'].includes(p.mode))assert.deepEqual(after.surfaces,before.surfaces,JSON.stringify({p,state,check:'flat preference parity'}));
  if(p.mode==='reduced')assert.equal(after.surfaces[0].bg,before.surfaces[0].bg,JSON.stringify({p,state,check:'opaque native fallback'}));
  const modeled = ratio => p.mode !== 'native' || (p.platform === 'macos' && (p.theme === 'light' ? ratio.backdrop >= 141 : ratio.backdrop <= 120));
  for(const r of after.ratios.filter(r=>modeled(r)&&!r.exception&&r.ratio<4.5)){
   const previous=before.ratios.find(b=>b.index===r.index&&b.backdrop===r.backdrop);
   issues.push({profile:p,state,...r,existing:!!previous&&previous.ratio<4.5,beforeRatio:previous?.ratio,worsened:!previous||r.ratio<previous.ratio-.01});
  }
  results.push({profile:p,state,before,after,status:'passed'});
  if(results.length%18===0)console.log(`${results.length}/216 width/text/state comparisons passed`);
 }
 await writeFile(`${root}/width-comparison.json`,JSON.stringify({base:'9fa35761c6e27a589f9da0d8bf887de325031a05',head:'802b7282d6f99b5acc8f80bab12b61c38769cda0',preliminary:false,browser:browser.version(),native:'CSS attributes only. Contrast modeled for macOS light native backdrops141/255, dark0/120. Windows Mica and artificial Linux material attributes are paint-parity stress cases only, excluded from contrast claims. Not native certification.',reducedTransparency:'real CSS branches activated via CSSOM; not browser/OS preference emulation',issues,results},null,2)+'\n');
 console.log(JSON.stringify({comparisons:results.length,contrastBelow45:issues.length,newOrWorseContrastBelow45:issues.filter(i=>!i.existing||i.worsened).length}));
 assert.equal(issues.filter(i=>!i.existing||i.worsened).length,0,'new or worsened text contrast failure');
}finally{servers.forEach(s=>s.close());await browser.close();}
