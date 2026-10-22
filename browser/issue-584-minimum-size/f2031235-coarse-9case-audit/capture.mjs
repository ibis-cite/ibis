// One-off synthetic evidence capture. Run against a clean, built checkout.
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const args=process.argv.slice(2), arg=n=>args[args.indexOf(n)+1];
const repo=path.resolve(arg('--repo')), output=path.resolve(arg('--output'));
const source=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
if(source!=='f2031235bf9692290abf31171301722df46f77ea')throw new Error('wrong source commit');
if(execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}).trim())throw new Error('dirty source checkout');
const {loadPlaywright,serve,PLATFORM_NAMES}=await import(pathToFileURL(path.join(repo,'scripts/gallery-contact-sheet.mjs')));
const browser=await(await loadPlaywright()).chromium.launch({headless:true});
const server=await serve(path.join(repo,'apps/desktop/dist'));
const selectors={search:'#search',disclosure:'.chip-more button',copy:'.footer-action:not(.shortcuts-hint)',more:'.more button'};
const results=[];
const settle=page=>page.evaluate(async()=>{await document.fonts.ready;for(let i=0;i<8;i++)await new Promise(requestAnimationFrame);});
async function snapshot(page){return page.evaluate(selectors=>{
 const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};
 const node=e=>e?{rect:rect(e),clientWidth:e.clientWidth,clientHeight:e.clientHeight,scrollWidth:e.scrollWidth,scrollHeight:e.scrollHeight,scrollTop:e.scrollTop,scrollLeft:e.scrollLeft}:null;
 const target=e=>{
  if(!e)return null;
  const r=rect(e);let c={left:Math.max(0,r.x),right:Math.min(innerWidth,r.right),top:Math.max(0,r.y),bottom:Math.min(innerHeight,r.bottom)};
  for(let a=e.parentElement;a;a=a.parentElement){const s=getComputedStyle(a),b=a.getBoundingClientRect();
   if(/auto|scroll|hidden|clip/.test(s.overflowX)){c.left=Math.max(c.left,b.left+a.clientLeft);c.right=Math.min(c.right,b.left+a.clientLeft+a.clientWidth);}
   if(/auto|scroll|hidden|clip/.test(s.overflowY)){c.top=Math.max(c.top,b.top+a.clientTop);c.bottom=Math.min(c.bottom,b.top+a.clientTop+a.clientHeight);}
  }
  const width=Math.max(0,c.right-c.left),height=Math.max(0,c.bottom-c.top),point=width&&height?{x:(c.left+c.right)/2,y:(c.top+c.bottom)/2}:null;
  const hit=point?document.elementFromPoint(point.x,point.y):null;
  return {rect:r,visibleWidth:width,visibleHeight:height,point,pointHitsTarget:!!hit&&(hit===e||e.contains(hit)),focused:e===document.activeElement,label:e.getAttribute('aria-label'),text:e.textContent};
 };
 const active=document.querySelector('[role="option"][data-active]'),focus=document.activeElement;
 return {mounted:!!document.querySelector('main'),rootFontPx:parseFloat(getComputedStyle(document.documentElement).fontSize),coarse:matchMedia('(pointer:coarse)').matches,
  document:node(document.scrollingElement),main:node(document.querySelector('main')),header:node(document.querySelector('.search-bar')),resultsArea:node(document.querySelector('.results-area')),shelf:node(document.querySelector('.shelf')),footer:node(document.querySelector('footer')),
  activeResult:target(active),targets:Object.fromEntries(Object.entries(selectors).map(([k,s])=>[k,target(document.querySelector(s))])),
  expanded:document.querySelector('.chip-more button')?.getAttribute('aria-expanded')==='true',galleryMarker:document.documentElement.dataset.galleryRendered,
  selectionText:[...document.querySelectorAll('p[aria-live]')].map(e=>e.textContent).find(t=>t?.includes('references selected for citation'))??null,
  focus:{tag:focus?.tagName,id:focus?.id,label:focus?.getAttribute('aria-label'),text:focus?.textContent?.slice(0,120)},menuCount:document.querySelectorAll('[role="menu"]').length,
  focusedMenuItem:focus?.closest('[role="menu"]')?target(focus):null};
 },selectors);}
try{
 await mkdir(output,{recursive:true});
 for(const platform of ['macos','windows','linux'])for(const mode of ['app115','root200','appLargerTimes2']){
  const row={source,platform,mode,theme:'light',viewport:{width:360,height:320},coarseRequested:true,phases:{},actions:[],errors:[],failures:[]};
  const context=await browser.newContext({viewport:{width:720,height:480},colorScheme:'light',reducedMotion:'reduce',hasTouch:true});
  const page=await context.newPage();page.setDefaultTimeout(1500);
  page.on('pageerror',e=>row.errors.push(e.message.slice(0,1200)));
  const dir=path.join(output,`${platform}-${mode}`);await mkdir(dir,{recursive:true});
  const deadline=Date.now()+15000;
  const guard=()=>{if(Date.now()>deadline)throw new Error('case exceeded 15-second evidence budget');};
  const record=async phase=>{guard();await settle(page);row.phases[phase]=await snapshot(page);await page.screenshot({path:path.join(dir,`${phase}.png`),timeout:2500});if(!row.phases[phase].mounted)row.failures.push(`${phase}: app unmounted`);return row.phases[phase];};
  const tap=async(name,phase)=>{guard();const facts=await snapshot(page),t=facts.targets[name];if(!t?.pointHitsTarget){row.actions.push({type:'touchscreen',target:name,attempted:false,reason:'no clipped visible point hits target'});row.failures.push(`${phase}: ${name} not pointer-hittable`);}else{await page.touchscreen.tap(t.point.x,t.point.y);row.actions.push({type:'touchscreen',target:name,attempted:true,point:t.point});}return record(phase);};
  try{
   await page.addInitScript(p=>Object.defineProperty(navigator,'platform',{configurable:true,get:()=>p}),PLATFORM_NAMES[platform]);
   await page.goto(`http://127.0.0.1:${server.address().port}/gallery.html?state=tray-50&platform=${platform}&theme=light&text=large`,{timeout:5000});
   await page.waitForFunction(()=>document.documentElement.dataset.galleryRendered==='tray-50',null,{timeout:5000});
   const setup=await record('setup-720x480');
   if(!setup.selectionText?.startsWith('50 references selected')||!setup.mounted)throw new Error('tray-50 acknowledgement missing');
   row.appLargerRootPx=setup.rootFontPx;
   await page.setViewportSize(row.viewport);
   if(mode!=='app115')await page.evaluate(size=>{document.documentElement.style.fontSize=`${size}px`;},mode==='root200'?32:row.appLargerRootPx*2);
   await record('initial-360x320');
   const searched=await tap('search','after-search-touch');
   if(searched.focus.id==='search'){await page.keyboard.press('ArrowUp');row.actions.push({type:'keyboard',key:'ArrowUp'});await record('after-search-arrow');}
   await tap('disclosure','after-disclosure-touch');
   let reached=false,tabs=0;
   for(;tabs<70;tabs++){guard();if(await page.evaluate(()=>document.activeElement===document.querySelector('.more button'))){reached=true;break;}if(!(await page.locator('main').count()))break;await page.keyboard.press('Tab');}
   row.actions.push({type:'keyboard',key:'Tab',count:tabs,reachedMore:reached});
   await record('more-keyboard-focus');
   if(reached){await page.keyboard.press('Enter');row.actions.push({type:'keyboard',key:'Enter',target:'More'});await record('menu-open');if(await page.getByRole('menu').count()){await page.keyboard.press('End');row.actions.push({type:'keyboard',key:'End'});await record('menu-end');await page.keyboard.press('Escape');row.actions.push({type:'keyboard',key:'Escape'});await record('menu-closed');}else row.failures.push('More keyboard activation did not open a menu');}
   else row.failures.push('More not reached within 70 Tab presses');
  }catch(error){row.failures.push(error.message);try{row.phases.exception=await snapshot(page);await page.screenshot({path:path.join(dir,'exception.png'),timeout:2000});}catch{}}
  finally{await context.close();results.push(row);await writeFile(path.join(output,'results.json'),JSON.stringify({source,browser:`Chromium ${browser.version()}`,captureType:'synthetic browser',pointer:'Playwright hasTouch:true; verified per-phase coarse media',fontModes:{app115:'app Larger text only; expected18.4px',root200:'32px root override, not composed',appLargerTimes2:'measured app Larger root multiplied by2; expected36.8px'},method:'Genuine touchscreen tap at a clipped visible hit point; keyboard ArrowUp/Tab/Enter/End/Escape. No DOM-click or focus fallback. Missing targets and unmounts are recorded failures.',results},null,2)+'\n');console.log(JSON.stringify({platform,mode,phases:Object.keys(row.phases),failures:row.failures,errors:row.errors}));}
 }
}finally{server.close();await browser.close();}
