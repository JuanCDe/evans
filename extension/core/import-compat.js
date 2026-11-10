import {legacyTokens} from './legacy.js';

// Compatibility is an input boundary. Never persist or export foreign UI markup.
export function textDocuments(record) {
  const markup = record.legacyDiff ?? record.diffHtml;
  if (markup) {
    const parts = legacyTokens(markup);
    return {before: parts.filter(p => p.type !== 'add').map(p => p.text).join(''),
      after: parts.filter(p => p.type !== 'remove').map(p => p.text).join('')};
  }
  return {before: String(record.before ?? record.previousContent ?? ''), after: String(record.after ?? record.currentContent ?? '')};
}

export function plainHistoryRecord(record) {
  const {legacyDiff, diffHtml, previousContent, currentContent, ...rest} = record;
  return {...rest, ...textDocuments(record)};
}

export function decodeOlderBackup(data) {
  const native = data?.format === 'evans';
  if (native && data.version !== undefined && data.version !== 1) throw new Error('Unsupported Evans backup version.');
  if (!native && (data?.format || !Array.isArray(data?.jobs))) throw new Error('Select an Evans archive or a supported older backup.');
  const pages = native ? data.pages : data.jobs;
  if (!Array.isArray(pages)) throw new Error('The backup has no page list.');
  return {native, exportedAt: data.exportedAt, pages,
    changes: (Array.isArray(data.changes) ? data.changes : []).map(c => ({
      id: c.id, pageId: c.pageId ?? c.jobId, runId: native ? c.runId : undefined,
      timestamp: c.timestamp, ...textDocuments(c), size: c.size ?? c.changeSize,
      percent: c.percent, matchedKeywords: c.matchedKeywords, filtered: c.filtered, read: c.read,
    })), runs: native ? data.runs || [] : [], checks: native ? data.checks || [] : []};
}
