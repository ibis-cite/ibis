import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
const { loadPlaywright, serve, PLATFORM_NAMES } = await import(pathToFileURL(path.resolve(process.env.IBIS_SOURCE ?? '.', 'scripts/gallery-contact-sheet.mjs')).href);
const root = path.resolve(process.argv[2] ?? '.');
const states=['menu-open', 'keys'];
const looks=['macos','windows','linux'];

let rows='';
for(const text of ['normal','large']) for(const state of states) for(const theme of ['light','dark']) {
  let cells='';
  for(const look of looks) for(const version of ['before','after']) {
    const data=await readFile(`${root}/${version}/${text}/${look}-${theme}/${state}.png`);
    cells+=`<td><img src="data:image/png;base64,${data.toString('base64')}"></td>`;
  }
  rows+=`<tr><th colspan="6">${state} · ${theme} · ${text} text</th></tr><tr>${cells}</tr>`;
}
const html=`<!doctype html><meta charset="utf-8"><style>body{margin:12px;background:#ddd;color:#18181b;font:13px system-ui}h1{font-size:18px;margin:0 0 8px}p{margin:0 0 12px}table{border-collapse:collapse}td{padding:2px;background:#bbb}th{padding:6px;text-align:left;background:#eee}img{width:360px;height:240px;display:block}</style><h1>#749 soft depth: before / after</h1><p>Synthetic browser comparison · actual main 9fa35761 → head 802b7282 · 96 selected frame pairs from the full gallery · fixed synthetic clock · no native-webview claim</p><table><tr>${looks.flatMap(look=>['before','after'].map(version=>`<th>${look} ${version}</th>`)).join('')}</tr>${rows}</table>`;
const browser=await(await loadPlaywright()).chromium.launch({headless:true});
try{const page=await browser.newPage({viewport:{width:2200,height:900},deviceScaleFactor:1});await page.setContent(html);await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:`${root}/comparison-3.png`,fullPage:true});console.log(`Comparison sheet rendered in Chromium ${browser.version()}`);}finally{await browser.close();}
