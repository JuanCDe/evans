import {all, get, put, transaction, removePages, prune} from './core/db.js';
import {makePage, canonicalUrl} from './core/model.js';
import {initializeWorkspace, mergeArchive} from './core/workspace.js';
import {analyzeChange} from './core/diff.js';
import {readPage, cleanupTabs} from './core/monitor.js';

let initialization, pumping = false;
const notifyUI = () => chrome.runtime.sendMessage({type: 'UPDATED'}).catch(() => {});
async function badge() {
  const n = (await all('pages')).reduce((sum, p) => sum + (p.unread || 0), 0);
  await chrome.action.setBadgeText({text: n ? String(n) : ''});
  await chrome.action.setBadgeBackgroundColor({color: '#7c3a68'});
}
async function initialize() {
  if (!initialization) initialization = (async () => {
    await initializeWorkspace();
    if (!await chrome.alarms.get('evans-tick')) await chrome.alarms.create('evans-tick', {periodInMinutes: 1});
    await cleanupTabs(); await badge();
  })().catch(e => { initialization = undefined; throw e; });
  return initialization;
}
async function startRun(ids, source = 'manual') {
  await initialize();
  let run;
  // One atomic reservation prevents two concurrent requests creating overlapping passes.
  await transaction(['settings', 'runs', 'pages'], 'readwrite', s => {
    const request = s.settings.get('activeRun');
    request.onsuccess = () => {
      if (request.result?.runId) { run = {id: request.result.runId, existing: true}; return; }
      const pagesRequest = s.pages.getAll();
      pagesRequest.onsuccess = () => {
        const pages = pagesRequest.result.filter(p => ids ? ids.includes(p.id) : p.enabled);
        if (!pages.length) return;
        run = {id: crypto.randomUUID(), startedAt: Date.now(), status: 'running', source, queue: pages.map(p => p.id), total: pages.length, completed: 0, changed: 0, errors: 0};
        s.runs.put(run); s.settings.put({id: 'activeRun', runId: run.id});
      };
    };
  });
  void pump().catch(reportBackgroundError); notifyUI(); return run;
}
async function checkPage(pageId, runId) {
  const page = await get('pages', pageId);
  if (!page) return;
  const timestamp = Date.now(), check = {id: `${runId}:${pageId}`, pageId, runId, timestamp};
  let snapshot, change, faviconUrl;
  try {
    const result = await readPage(page);
    faviconUrl = result.faviconUrl;
    const old = await get('snapshots', pageId);
    snapshot = {id: pageId, text: result.text, timestamp, configVersion: page.configVersion, normalizedSlick: result.normalizedSlick};
    check.title = result.title; check.characters = result.text.length;
    // Older carousel snapshots only contain whichever slides happened to be active.
    const carouselBaseline = old?.normalizedSlick === undefined && result.normalizedSlick;
    if (!old || old.configVersion !== page.configVersion || carouselBaseline) check.status = 'baseline';
    else if (old.text === result.text) check.status = 'unchanged';
    else {
      const analysis = analyzeChange(old.text, result.text, page);
      check.status = analysis.size === 0 ? 'unchanged' : analysis.relevant ? 'changed' : 'filtered';
      check.percent = analysis.percent;
      // Filtered differences are retained too, so every pass remains auditable.
      if(analysis.size > 0) change = {id: check.id, pageId, runId, timestamp, before: analysis.before, after: analysis.after, size: analysis.size, percent: analysis.percent, matchedKeywords: analysis.matchedKeywords, filtered: !analysis.relevant, read: !analysis.relevant};
    }
  } catch (e) { check.status = 'error'; check.error = e.message || 'Unable to check page.'; }
  let committed = false;
  await transaction(['pages', 'snapshots', 'checks', 'changes'], 'readwrite', s => {
    const request = s.pages.get(pageId);
    request.onsuccess = () => {
      const current = request.result;
      if (!current) return;
      if (current.configVersion !== page.configVersion) { check.status = 'skipped'; check.error = 'Settings changed during capture. Retrying next run.'; snapshot = null; change = null; }
      if (snapshot) s.snapshots.put(snapshot);
      if (change) s.changes.put(change);
      if (snapshot && faviconUrl) current.faviconUrl = faviconUrl;
      current.lastCheckedAt = timestamp; current.lastStatus = check.status; current.error = check.error || '';
      current.errorCount = check.status === 'error' ? (current.errorCount || 0) + 1 : 0;
      current.nextCheckAt = Date.now() + Math.min(current.intervalSeconds * Math.pow(2, Math.min(current.errorCount, 3)), 604800) * 1000;
      if (check.status === 'changed') { current.lastChangedAt = timestamp; current.unread = (current.unread || 0) + 1; }
      s.pages.put(current); s.checks.put(check); committed = true;
    };
  });
  if (committed && check.status === 'changed') {
    const prefs = await get('settings', 'preferences');
    if (prefs.notifications && page.notifications) {
      try { await chrome.notifications.create(change.id, {type: 'basic', iconUrl: 'assets/icon128.png', title: `${page.name} changed`, message: `${new URL(page.url).hostname}\n${change.matchedKeywords.length ? 'Matches: ' + change.matchedKeywords.join(', ') : 'Open to review changes.'}`, priority: 1}); }
      catch (e) { await put('settings', {id: 'notificationError', message: e.message, timestamp: Date.now()}); }
    }
  }
  await badge(); notifyUI();
}
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    await initialize();
    const active = await get('settings', 'activeRun');
    if (!active?.runId) return;
    let run = await get('runs', active.runId);
    if (!run || run.status !== 'running') { await put('settings', {id: 'activeRun', runId: null}); return; }
    while (true) {
      const checks = await all('checks', 'runId', run.id);
      const finished = new Set(checks.map(c => c.pageId));
      const pages = new Set((await all('pages')).map(p => p.id));
      const remaining = run.queue.filter(id => !finished.has(id) && pages.has(id));
      run.completed = run.queue.length - remaining.length;
      run.changed = checks.filter(c => c.status === 'changed').length;
      run.errors = checks.filter(c => c.status === 'error').length;
      const stop = await get('settings', 'stopRun');
      if (!remaining.length || stop?.runId === run.id) {
        run.status = stop?.runId === run.id ? 'cancelled' : 'complete'; run.endedAt = Date.now();
        await transaction(['runs', 'settings'], 'readwrite', s => { s.runs.put(run); s.settings.put({id: 'activeRun', runId: null}); s.settings.delete('stopRun'); });
        await prune((await get('settings', 'preferences')).retentionDays); notifyUI(); break;
      }
      await put('runs', run); notifyUI();
      const prefs = await get('settings', 'preferences');
      await Promise.all(remaining.slice(0, Math.max(1, Math.min(4, prefs.concurrency))).map(id => checkPage(id, run.id)));
    }
  } finally { pumping = false; }
}
function reportBackgroundError(e) { console.error('Evans:', e); void put('settings', {id: 'backgroundError', message: e.message, timestamp: Date.now()}).then(notifyUI); }
async function tick() {
  await initialize();
  if ((await get('settings', 'activeRun'))?.runId) return pump();
  const prefs = await get('settings', 'preferences'); if (prefs.paused) return;
  const due = (await all('pages')).filter(p => p.enabled && p.nextCheckAt <= Date.now());
  if (due.length) await startRun(due.map(p => p.id), 'scheduled');
}
async function importData(data) {
  const result = await mergeArchive(data);
  await badge(); notifyUI(); return result;
}

async function handle(message, sender) {
  await initialize();
  switch (message.type) {
    case 'STATUS': return {pages: await all('pages'), settings: await get('settings', 'preferences'), activeRun: await get('settings', 'activeRun')};
    case 'RUN': return startRun(message.ids);
    case 'STOP': { const active = await get('settings', 'activeRun'); if (active?.runId) await put('settings', {id: 'stopRun', runId: active.runId}); return true; }
    case 'ADD': {
      const existing = await all('pages'), seen = new Set(existing.map(p => canonicalUrl(p.url))), pages = []; let duplicates = 0;
      for (const input of message.pages || []) { const key = canonicalUrl(input.url); if (seen.has(key)) { duplicates++; continue; } seen.add(key); pages.push(makePage(input, await get('settings', 'preferences'))); }
      await transaction(['pages'], 'readwrite', s => pages.forEach(p => s.pages.put(p))); notifyUI(); return {added: pages.length, duplicates};
    }
    case 'UPDATE_PAGE': {
      const old = await get('pages', message.page.id); if (!old) throw new Error('Page no longer exists.');
      const config = makePage({...old, ...message.page});
      if (old.url !== config.url) config.faviconUrl = '';
      const fields = ['url', 'mode', 'selector', 'excludeSelectors', 'ignoreNumbers', 'ignoreTimestamps', 'ignorePatterns'];
      const reset = fields.some(k => JSON.stringify(old[k]) !== JSON.stringify(config[k]));
      await put('pages', {...old, ...config, lastCheckedAt: old.lastCheckedAt, lastChangedAt: old.lastChangedAt, lastStatus: old.lastStatus, unread: old.unread, error: old.error, errorCount: old.errorCount, nextCheckAt: Date.now() + config.intervalSeconds * 1000, configVersion: (old.configVersion || 1) + (reset ? 1 : 0)}); notifyUI(); return true;
    }
    case 'BULK_UPDATE': {
      await transaction(['pages'], 'readwrite', s => {
        for (const id of message.ids) { const r = s.pages.get(id); r.onsuccess = () => { if (r.result) s.pages.put({...r.result, ...message.patch}); }; }
      }); notifyUI(); return true;
    }
    case 'DELETE': await removePages(message.ids); await badge(); notifyUI(); return true;
    case 'IMPORT': return importData(message.data);
    case 'READ': {
      await transaction(['changes', 'pages'], 'readwrite', s => {
        const r = s.changes.getAll(); r.onsuccess = () => {
          const affected = new Set();
          for (const c of r.result) if ((!message.ids || message.ids.includes(c.id)) && !c.read) { s.changes.put({...c, read: true}); affected.add(c.pageId); }
          for (const id of affected) { const p = s.pages.get(id); p.onsuccess = () => { if (p.result) { const c = s.changes.index('pageId').getAll(id); c.onsuccess = () => s.pages.put({...p.result, unread: c.result.filter(v => !v.read && !v.filtered).length}); } }; }
        };
      }); await badge(); notifyUI(); return true;
    }
    case 'SETTINGS': { const p = await get('settings', 'preferences'); await put('settings', {...p, ...message.patch, id: 'preferences'}); notifyUI(); return true; }
    case 'PICK': {
      const p = await get('pages', message.pageId); if (!p) throw new Error('Page not found.');
      const tab = await chrome.tabs.create({url: p.url});
      await chrome.storage.session.set({[`picker:${tab.id}`]: {pageId: p.id}}); return true;
    }
    case 'PICKED': {
      const key = `picker:${sender.tab?.id}`, pending = (await chrome.storage.session.get(key))[key];
      if (!pending) throw new Error('Selection expired. Pick a region again.');
      const p = await get('pages', pending.pageId);
      if (p) await put('pages', {...p, selector: String(message.selector), configVersion: p.configVersion + 1, nextCheckAt: Date.now()});
      await chrome.storage.session.remove(key); notifyUI(); return true;
    }
    case 'TEST_NOTIFICATION': await chrome.notifications.create('evans-test', {type: 'basic', iconUrl: 'assets/icon128.png', title: 'Evans · Notification test', message: 'Page changes show their name and domain here.'}); return true;
    default: throw new Error('Unknown action.');
  }
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || message.target === 'offscreen' || message.type === 'UPDATED') return;
  // Content scripts can only submit an explicitly requested visual selection.
  if (sender.tab && !sender.url?.startsWith(chrome.runtime.getURL('')) && message.type !== 'PICKED') return;
  handle(message, sender).then(data => reply({ok: true, data})).catch(e => reply({ok: false, error: e.message})); return true;
});
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'evans-tick') void tick().catch(reportBackgroundError); });
chrome.runtime.onStartup.addListener(() => { void tick().catch(reportBackgroundError); });
chrome.runtime.onInstalled.addListener(details => {
  void initialize().then(async () => {
    if (details.reason === 'install') await chrome.tabs.create({url: chrome.runtime.getURL('index.html')});
  }).catch(reportBackgroundError);
});
chrome.tabs.onUpdated.addListener((id, info) => {
  if (info.status !== 'complete') return;
  void chrome.storage.session.get(`picker:${id}`).then(async data => {
    if (data[`picker:${id}`]) { try { await chrome.scripting.executeScript({target: {tabId: id}, files: ['picker.js']}); } catch { await chrome.storage.session.remove(`picker:${id}`); } }
  });
});
chrome.notifications.onClicked.addListener(id => { void chrome.tabs.create({url: chrome.runtime.getURL(`index.html#changes/${encodeURIComponent(id)}`)}); });
void initialize().then(() => pump()).catch(reportBackgroundError);
