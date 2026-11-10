import {all, get, put, transaction, removePages} from '../core/db.js';
import {makePage, canonicalUrl} from '../core/model.js';
import {initializeWorkspace, mergeArchive} from '../core/workspace.js';
export const isExtension = !!globalThis.chrome?.runtime?.id;
export async function request(type, data = {}) {
  if (isExtension) {
    const result = await chrome.runtime.sendMessage({type, ...data});
    if (!result?.ok) throw new Error(result?.error || 'No se pudo conectar con Evans. Recarga la extensión.');
    return result.data;
  }
  // Local preview edits persist only in this preview's IndexedDB, separate from the extension.
  switch (type) {
    case 'STATUS': {
      await initializeWorkspace();
      return {pages: await all('pages'), settings: await get('settings', 'preferences')};
    }
    case 'ADD': {
      const seen = new Set((await all('pages')).map(p => canonicalUrl(p.url))), pages = [];
      const defaults = await get('settings', 'preferences'); let duplicates = 0;
      for (const input of data.pages || []) {
        const key = canonicalUrl(input.url); if (seen.has(key)) { duplicates++; continue; }
        seen.add(key); pages.push(makePage(input, defaults));
      }
      await transaction(['pages'], 'readwrite', s => pages.forEach(p => s.pages.put(p)));
      return {added:pages.length, duplicates};
    }
    case 'IMPORT': return mergeArchive(data.data);
    case 'UPDATE_PAGE': { const p = await get('pages', data.page.id); await put('pages', {...p, ...data.page, faviconUrl: p.url === data.page.url ? data.page.faviconUrl || '' : ''}); return true; }
    case 'BULK_UPDATE': for (const id of data.ids) await put('pages', {...await get('pages', id), ...data.patch}); return true;
    case 'DELETE': await removePages(data.ids); return true;
    case 'SETTINGS': await put('settings', {...await get('settings', 'preferences'), ...data.patch}); return true;
    case 'READ': {
      for (const c of await all('changes')) if (!data.ids || data.ids.includes(c.id)) await put('changes', {...c, read: true});
      for (const p of await all('pages')) await put('pages', {...p, unread: (await all('changes', 'pageId', p.id)).filter(c => !c.read && !c.filtered).length});
      return true;
    }
    default: throw new Error('Install the extension to use this action.');
  }
}
