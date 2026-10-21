import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const [repo, output] = process.argv.slice(2);
const {openGallery, PLATFORM_NAMES} = await import(pathToFileURL(`${repo}/scripts/gallery-contact-sheet.mjs`));
const {browser,server}=await openGallery({build:false,dist:`${repo}/apps/desktop/dist`});
const results=[];
const frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
try {
for(const platform of ['macos','windows','linux']) for(const action of ['repeat-more','keys-while-closing','plain-key']) {
 const page=await browser.newPage({viewport:{width:720,height:480},reducedMotion:'no-preference'});
 page.setDefaultTimeout(3000);
 try {
  await page.addInitScript(value=>Object.defineProperty(navigator,'platform',{get:()=>value,configurable:true}),PLATFORM_NAMES[platform]);
  await page.goto(`http://127.0.0.1:${server.address().port}/gallery.html?state=many-results&platform=${platform}&theme=light`);
  await page.waitForFunction(()=>document.documentElement.dataset.galleryRendered==='many-results');
  await page.getByRole('button',{name:/^Copy as /}).click();
  await page.getByRole('searchbox',{name:'Filter formats'}).fill('Typst');
  const modifier=platform==='macos'?'Meta':'Control';
  await page.keyboard.press(`${modifier}+k`);
  const closing=await page.locator('.toolbar-menu-popover').evaluate(el=>({exiting:el.hasAttribute('data-exiting'),active:document.activeElement?.outerHTML})).catch(()=>({removed:true}));
  if(action==='repeat-more') await page.keyboard.press(`${modifier}+k`);
  else if(action==='keys-while-closing') await page.keyboard.press(`${modifier}+/`);
  else await page.keyboard.press('x');
  if(action==='plain-key') {
   await page.locator('.toolbar-menu-popover').waitFor({state:'detached'});
  } else if(action==='repeat-more') {
   await page.getByRole('menu',{name:/^More/}).waitFor();
   await page.keyboard.press('Tab');
   await page.getByRole('menu',{name:/^More/}).waitFor({state:'detached'});
  } else {
   await page.getByRole('dialog',{name:'Keyboard shortcuts'}).waitFor();
   await page.waitForFunction(()=>document.activeElement?.textContent==='Close');
   await page.keyboard.press('Escape');
   await page.getByRole('dialog',{name:'Keyboard shortcuts'}).waitFor({state:'detached'});
  }
  await page.evaluate(frames);
  const final=await page.evaluate(()=>({search:document.activeElement===document.querySelector('#search'),active:document.activeElement?.outerHTML,format:document.querySelector('.toolbar-menu-button')?.getAttribute('aria-expanded'),more:!!document.querySelector('[role=menu]'),inert:document.querySelector('main')?.inert}));
  results.push({platform,action,closing,final});
 }catch(error){results.push({platform,action,error:error.message});}
 finally {await page.close();}
}
}finally{await browser.close();server.close();}
await writeFile(output,JSON.stringify({source:'2614b89b938e7a2e27ca7bcf0409535e0f55454e',results},null,2));
console.log(JSON.stringify(results,null,2));
