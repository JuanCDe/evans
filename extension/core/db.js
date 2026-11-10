const DB_NAME = 'evans-observatory';
let connection;
export function db() {
  return connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const d = request.result;
      for (const name of ['pages', 'snapshots', 'settings', 'runs', 'checks', 'changes']) {
        const store = d.createObjectStore(name, { keyPath: 'id' });
        if (['checks', 'changes'].includes(name)) {
          store.createIndex('pageId', 'pageId');
          store.createIndex('runId', 'runId');
          store.createIndex('timestamp', 'timestamp');
        }
      }
    };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); connection = undefined; }; resolve(request.result); };
    request.onerror = () => { connection = undefined; reject(request.error); };
  });
}
export async function transaction(names, mode, action) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(names, mode);
    const stores = Object.fromEntries(names.map(n => [n, tx.objectStore(n)]));
    let value;
    try { value = action(stores); } catch (e) { tx.abort(); reject(e); return; }
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Unable to save changes.'));
  });
}
export async function get(store, id) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = d.transaction(store).objectStore(store).get(id);
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
export async function all(store, index, key) {
  const d = await db();
  return new Promise((resolve, reject) => {
    let s = d.transaction(store).objectStore(store);
    if (index) s = s.index(index);
    const r = key === undefined ? s.getAll() : s.getAll(key);
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
export const put = (store, value) => transaction([store], 'readwrite', s => { s[store].put(value); });
export async function removePages(ids) {
  await transaction(['pages', 'snapshots', 'checks', 'changes'], 'readwrite', s => {
    for (const id of ids) {
      s.pages.delete(id); s.snapshots.delete(id);
      for (const name of ['checks', 'changes']) {
        const r = s[name].index('pageId').openCursor(IDBKeyRange.only(id));
        r.onsuccess = () => { const c = r.result; if (c) { c.delete(); c.continue(); } };
      }
    }
  });
}
export async function prune(days) {
  if (!days) return;
  const cutoff = Date.now() - days * 86400000;
  await transaction(['checks', 'changes', 'runs'], 'readwrite', s => {
    for (const name of ['checks', 'changes', 'runs']) {
      const r = s[name].openCursor();
      r.onsuccess = () => { const c = r.result; if (c) { const v = c.value; if ((v.timestamp || v.startedAt) < cutoff && v.status !== 'running') c.delete(); c.continue(); } };
    }
  });
}
