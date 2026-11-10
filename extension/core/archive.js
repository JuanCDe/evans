import {decodeOlderBackup, textDocuments} from './import-compat.js';

export const ARCHIVE_SCHEMA = 'urn:evans:workspace';
export const ARCHIVE_VERSION = 2;
const list = (value, name) => {
  if (!Array.isArray(value)) throw new Error(`Invalid Evans archive: ${name} must be a list.`);
  return value;
};

// A workspace describes what to watch; its journal records the evidence.
// This public file format is independent of the browser's IndexedDB layout.
export function createArchive({pages = [], changes = [], runs = [], checks = [], settings = {}} = {}, createdAt = new Date().toISOString()) {
  return {schema: ARCHIVE_SCHEMA, schemaVersion: ARCHIVE_VERSION, createdAt,
    workspace: {preferences: {appearance: settings.theme, scheduling: {paused: settings.paused,
      defaultEverySeconds: settings.defaultInterval, parallelCaptures: settings.concurrency},
      desktopAlerts: settings.notifications, keepDays: settings.retentionDays},
    sources: pages.map(p => ({key: p.id, address: p.url, label: p.name, icon: p.faviconUrl || '',
      schedule: {active: p.enabled, everySeconds: p.intervalSeconds},
      capture: {engine: p.mode, region: p.selector, omit: p.excludeSelectors,
        cleanup: {numbers: p.ignoreNumbers, clocks: p.ignoreTimestamps, phrases: p.ignorePatterns}},
      signals: {terms: p.keywords, scope: p.keywordMode, minimumPercent: p.threshold},
      labels: p.tags, desktopAlert: p.notifications, addedAt: p.createdAt}))},
    journal: {
      revisions: changes.map(c => {const {before, after} = textDocuments(c); return {
        key: c.id, source: c.pageId, session: c.runId, recordedAt: c.timestamp,
        documents: {earlier: before, later: after},
        delta: {characters: c.size, percentage: c.percent, terms: c.matchedKeywords || []},
        review: {seen: !!c.read, suppressed: !!c.filtered}};}),
      sessions: runs.map(r => ({key: r.id, openedAt: r.startedAt, closedAt: r.endedAt,
        state: r.status, trigger: r.source, members: r.queue || [],
        counts: {planned: r.total, finished: r.completed, revised: r.changed, failed: r.errors}})),
      observations: checks.map(c => ({key: c.id, source: c.pageId, session: c.runId,
        recordedAt: c.timestamp, result: c.status, title: c.title, characters: c.characters,
        percentage: c.percent, problem: c.error})),
    }};
}

export function decodeArchive(data) {
  if (data?.schema !== ARCHIVE_SCHEMA) {
    if (data?.schema) throw new Error('This is not an Evans workspace archive.');
    return decodeOlderBackup(data);
  }
  if (data.schemaVersion !== ARCHIVE_VERSION) throw new Error('Unsupported Evans archive version. Update Evans before importing this file.');
  const sources = list(data.workspace?.sources, 'workspace.sources');
  const revisions = list(data.journal?.revisions, 'journal.revisions');
  const sessions = list(data.journal?.sessions, 'journal.sessions');
  const observations = list(data.journal?.observations, 'journal.observations');
  const keys = new Set();
  for (const source of sources) {
    if (!source?.key || typeof source.key !== 'string' || keys.has(source.key)) throw new Error('Source keys must be unique strings.');
    keys.add(source.key);
  }
  for (const entry of [...revisions, ...observations]) {
    if (!entry?.key || !keys.has(entry.source)) throw new Error('A journal entry references a missing source.');
  }
  return {native: true, exportedAt: data.createdAt,
    pages: sources.map(s => ({id: s.key, url: s.address, name: s.label, faviconUrl: s.icon,
      enabled: s.schedule?.active, intervalSeconds: s.schedule?.everySeconds,
      mode: s.capture?.engine, selector: s.capture?.region, excludeSelectors: s.capture?.omit,
      ignoreNumbers: s.capture?.cleanup?.numbers, ignoreTimestamps: s.capture?.cleanup?.clocks,
      ignorePatterns: s.capture?.cleanup?.phrases, keywords: s.signals?.terms,
      keywordMode: s.signals?.scope, threshold: s.signals?.minimumPercent,
      tags: s.labels, notifications: s.desktopAlert, createdAt: s.addedAt})),
    changes: revisions.map(r => {
      if (typeof r.documents?.earlier !== 'string' || typeof r.documents?.later !== 'string') throw new Error('Revision documents must contain plain text.');
      return {id: r.key, pageId: r.source, runId: r.session, timestamp: r.recordedAt,
        before: r.documents.earlier, after: r.documents.later, size: r.delta?.characters,
        percent: r.delta?.percentage, matchedKeywords: r.delta?.terms,
        read: r.review?.seen, filtered: r.review?.suppressed};
    }),
    runs: sessions.map(s => ({id: s.key, startedAt: s.openedAt, endedAt: s.closedAt, status: s.state,
      source: s.trigger, queue: s.members, total: s.counts?.planned, completed: s.counts?.finished,
      changed: s.counts?.revised, errors: s.counts?.failed})),
    checks: observations.map(o => ({id: o.key, pageId: o.source, runId: o.session, timestamp: o.recordedAt,
      status: o.result, title: o.title, characters: o.characters, percent: o.percentage, error: o.problem})),
  };
}
