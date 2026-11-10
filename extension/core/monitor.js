import {extractDocument} from './extract.js';
let creating;
async function offscreen() {
  if ((await chrome.runtime.getContexts({contextTypes: ['OFFSCREEN_DOCUMENT']})).length) return;
  if (!creating) creating = chrome.offscreen.createDocument({url: 'offscreen.html', reasons: ['DOM_PARSER'], justification: 'Parse downloaded HTML without executing remote code.'}).finally(() => { creating = null; });
  await creating;
}
async function fetchText(page) {
  const response = await fetch(page.url, {signal: AbortSignal.timeout(20000), credentials: 'include', cache: 'no-store', redirect: 'follow'});
  if (!response.ok) throw new Error(`Site returned HTTP ${response.status}.`);
  const contentType = response.headers.get('content-type') || '';
  if (!/text\/html|application\/xhtml/.test(contentType)) throw new Error('URL does not return HTML.');
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  while (true) {
    const {value, done} = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 5000000) { await reader.cancel(); throw new Error('HTML exceeds 5 MB. Use rendered mode with a selected region.'); }
    chunks.push(value);
  }
  const html = await new Blob(chunks).text();
  await offscreen();
  const result = await chrome.runtime.sendMessage({target: 'offscreen', type: 'EXTRACT', html, options: {...page, url:response.url}});
  if (!result?.ok) throw new Error(result?.error || 'Unable to read page.');
  return {...result.data, url: response.url};
}
const delay = ms => new Promise(r => setTimeout(r, ms));
export async function cleanupTabs() {
  const {evansTabs = []} = await chrome.storage.session.get('evansTabs');
  // Session storage is cleared on browser restart; these IDs belong only to our unfinished reads.
  await Promise.all(evansTabs.map(async ({id}) => {
    try { await chrome.tabs.remove(id); } catch {}
  }));
  await chrome.storage.session.set({evansTabs: []});
}
let tabWrites = Promise.resolve();
function trackTab(tab, add) {
  tabWrites = tabWrites.catch(() => {}).then(async () => {
    const {evansTabs = []} = await chrome.storage.session.get('evansTabs');
    await chrome.storage.session.set({evansTabs: add ? [...evansTabs, {id: tab.id, url: tab.url || tab.pendingUrl}] : evansTabs.filter(t => t.id !== tab.id)});
  });
  return tabWrites;
}
async function renderedText(page) {
  const tab = await chrome.tabs.create({url: page.url, active: false});
  await trackTab({...tab, url: page.url}, true);
  try {
    const started = Date.now();
    while (Date.now() - started < 24000) {
      const state = await chrome.tabs.get(tab.id);
      if (state.status === 'complete') break;
      await delay(500);
    }
    if ((await chrome.tabs.get(tab.id)).status !== 'complete') throw new Error('Page load exceeded 24 seconds.');
    // Settle hydrated job boards, with a bounded wait and an API heartbeat while the page changes.
    let previous = '', stable = 0;
    for (let i = 0; i < 10; i++) {
      await delay(1000);
      const [{result}] = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: () => document.body?.innerText || ''});
      stable = result === previous ? stable + 1 : 0; previous = result;
      if (i >= 3 && stable >= 2 && result.length > 80) break;
    }
    const [{result}] = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: extractDocument, args: [page]});
    if (!result) throw new Error('Unable to read rendered page.');
    const original = new URL(page.url), final = new URL(result.url);
    if (original.origin !== final.origin || /\/log-?in|\/sign-?in|\/auth\//i.test(final.pathname)) throw new Error(`Site redirected to ${final.hostname}${final.pathname}. Update the URL or sign in to the site.`);
    return result;
  } finally {
    try { await chrome.tabs.remove(tab.id); } catch {}
    await trackTab(tab, false);
  }
}
export const readPage = page => page.mode === 'fetch' ? fetchText(page) : renderedText(page);
