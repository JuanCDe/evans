import {decodeArchive} from './archive.js';

export const DEFAULT_SETTINGS = {id: 'preferences', paused: false, notifications: true, defaultInterval: 86400, concurrency: 2, retentionDays: 0, theme: 'dark'};
export function validUrl(value) {
  const u = new URL(String(value).trim());
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('Use an HTTP or HTTPS URL without credentials.');
  return u.href;
}
export function canonicalUrl(value) { const u = new URL(validUrl(value)); u.hash = ''; return u.href.replace(/\/$/, ''); }
export function makePage(input, defaults = {}) {
  const url = validUrl(input.url);
  let faviconUrl = '';
  try { if (input.faviconUrl) faviconUrl = validUrl(input.faviconUrl); } catch {}
  return {
    id: input.id || crypto.randomUUID(), url, faviconUrl, name: String(input.name || new URL(url).hostname.replace(/^www\./, '')).slice(0, 160),
    enabled: input.enabled !== false, intervalSeconds: Math.max(60, Number(input.intervalSeconds || defaults.defaultInterval) || 86400),
    mode: ['fetch', 'rendered'].includes(input.mode) ? input.mode : 'rendered',
    selector: String(input.selector || ''), excludeSelectors: Array.isArray(input.excludeSelectors) ? input.excludeSelectors.map(String) : [],
    keywords: Array.isArray(input.keywords) ? input.keywords.map(String).filter(Boolean) : [],
    keywordMode: ['added', 'removed'].includes(input.keywordMode) ? input.keywordMode : 'any',
    threshold: Math.max(0, Math.min(100, Number(input.threshold) || 0)),
    ignoreNumbers: !!input.ignoreNumbers, ignoreTimestamps: input.ignoreTimestamps !== false, ignorePatterns: Array.isArray(input.ignorePatterns) ? input.ignorePatterns.map(String) : [],
    tags: Array.isArray(input.tags) ? input.tags.map(String).filter(Boolean) : [], notifications: typeof input.notifications === 'object' ? input.notifications.browser !== false : input.notifications !== false,
    createdAt: Number(input.createdAt) || Date.now(), lastCheckedAt: null, lastChangedAt: null, lastStatus: 'pending', unread: 0,
    error: '', errorCount: 0, nextCheckAt: Date.now(), configVersion: 1,
  };
}
export function parseBulk(text) {
  const entries = [], invalid = [];
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim(); if (!line) continue;
    const match = line.match(/https?:\/\/[^\s<>"|]+/i);
    if (!match) { invalid.push({line: index + 1, value: line}); continue; }
    try {
      const url = validUrl(match[0]);
      const name = line.replace(match[0], '').replace(/^[\s,;|\t]+|[\s,;|\t]+$/g, '').replace(/^"|"$/g, '');
      entries.push({url, name});
    } catch { invalid.push({line: index + 1, value: line}); }
  }
  return {entries, invalid};
}
export function prepareImport(data, existing = [], defaults = DEFAULT_SETTINGS) {
  const decoded = decodeArchive(data), {native, exportedAt} = decoded;
  const inputs = decoded.pages;
  const seen = new Map(existing.map(p => [canonicalUrl(p.url), p.id]));
  const pages = [], mapping = new Map(); let duplicates = 0;
  for (const input of inputs) {
    const key = canonicalUrl(input.url);
    if (seen.has(key)) { duplicates++; if (input.id) mapping.set(input.id, seen.get(key)); continue; }
    const page = makePage({...input, id: crypto.randomUUID()}, defaults);
    // Imported snapshots have different extraction rules. First local check establishes a clean baseline.
    page.imported = true;
    seen.set(key, page.id); if (input.id) mapping.set(input.id, page.id); pages.push(page);
  }
  const changes = decoded.changes.flatMap(c => {
    const pageId = mapping.get(c.pageId); if (!pageId) return [];
    return [{id: native && c.id ? String(c.id) : `import:${c.id || crypto.randomUUID()}`, pageId, runId: native ? String(c.runId || `import:${exportedAt || 'legacy'}`) : `import:${exportedAt || 'legacy'}`, timestamp: Number(c.timestamp) || Date.now(),
      before: String(c.before ?? ''), after: String(c.after ?? ''),
      size: Number(c.size) || 0, percent: Number(c.percent) || 0, matchedKeywords: Array.isArray(c.matchedKeywords) ? c.matchedKeywords.map(String) : [], imported: true, filtered: c.filtered === true, read: c.read === true || c.filtered === true, originalRunId: c.runId}];
  });
  for (const p of pages) {
    const history = changes.filter(c => c.pageId === p.id);
    p.unread = history.filter(c => !c.read).length;
    p.lastChangedAt = history.length ? Math.max(...history.map(c => c.timestamp)) : null;
  }
  const runs = decoded.runs.map(r => ({...r, status: r.status === 'running' ? 'cancelled' : r.status, queue: (r.queue || []).map(id => mapping.get(id)).filter(Boolean)}));
  const checks = decoded.checks.filter(c => mapping.has(c.pageId)).map(c => ({...c, pageId: mapping.get(c.pageId)}));
  return {pages, changes, runs, checks, duplicates, mapping, native, exportedAt};
}
