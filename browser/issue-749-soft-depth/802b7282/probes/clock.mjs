import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { loadPlaywright, serve, PLATFORM_NAMES } = await import(pathToFileURL(path.resolve(process.env.IBIS_SOURCE ?? '.', 'scripts/gallery-contact-sheet.mjs')).href);
const playwright=await loadPlaywright();
const launch=playwright.chromium.launch.bind(playwright.chromium);
playwright.chromium.launch=async(...args)=>{
  const browser=await launch(...args),newContext=browser.newContext.bind(browser);
  browser.newContext=async(...options)=>{
    const context=await newContext(...options);
    await context.addInitScript(()=>{Date.now=()=>Date.parse('2026-10-22T09:00:00Z');});
    return context;
  };
  return browser;
};
