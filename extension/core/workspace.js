import {all, get, transaction} from './db.js';
import {DEFAULT_SETTINGS, prepareImport} from './model.js';
import {plainHistoryRecord} from './import-compat.js';

export async function initializeWorkspace() {
  await transaction(['settings'], 'readwrite', s => {
    const request = s.settings.get('preferences');
    request.onsuccess = () => {
      if (!request.result) s.settings.put({...DEFAULT_SETTINGS});
    };
  });
  if (!await get('settings', 'textHistoryV2')) {
    await transaction(['changes', 'settings'], 'readwrite', s => {
      const request = s.changes.openCursor();
      request.onsuccess = () => {
        const cursor = request.result; if (!cursor) return;
        if (['legacyDiff','diffHtml','previousContent','currentContent'].some(k => k in cursor.value)) cursor.update(plainHistoryRecord(cursor.value));
        cursor.continue();
      };
      s.settings.put({id: 'textHistoryV2', completedAt: Date.now()});
    });
  }
}

export async function mergeArchive(data) {
  if ((await get('settings', 'activeRun'))?.runId) throw new Error('Wait for the current run to finish before importing.');
  const prepared = prepareImport(data, await all('pages'), await get('settings', 'preferences'));
  const {pages, changes, runs, checks} = prepared;
  if (!prepared.native) runs.push({id: `import:${prepared.exportedAt || 'legacy'}`,
    startedAt: Date.parse(prepared.exportedAt) || Date.now(), status:'imported', source:'migration',
    total:pages.length, completed:pages.length, changed:new Set(changes.map(c=>c.pageId)).size, errors:0, queue:[]});
  await transaction(['pages', 'changes', 'runs', 'checks'], 'readwrite', s => {
    pages.forEach(p => s.pages.put(p)); changes.forEach(c => s.changes.put(c));
    runs.forEach(r => s.runs.put(r)); checks.forEach(c => s.checks.put(c));
    const request = s.pages.getAll(); request.onsuccess = () => {
      for (const page of request.result) {
        const history = s.changes.index('pageId').getAll(page.id);
        history.onsuccess = () => s.pages.put({...page,
          unread:history.result.filter(c=>!c.read&&!c.filtered).length,
          lastChangedAt:history.result.length ? Math.max(...history.result.map(c=>c.timestamp)) : page.lastChangedAt});
      }
    };
  });
  return {added:pages.length, duplicates:prepared.duplicates, changes:changes.length};
}
