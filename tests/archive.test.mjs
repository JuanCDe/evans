import test from 'node:test';
import assert from 'node:assert/strict';
import {createArchive, decodeArchive, ARCHIVE_SCHEMA} from '../extension/core/archive.js';
import {prepareImport, makePage, DEFAULT_SETTINGS} from '../extension/core/model.js';
import {changeDocuments} from '../extension/core/comparison.js';
import {plainHistoryRecord} from '../extension/core/import-compat.js';

const date = '2026-11-04T10:00:00.000Z';
const fixture = () => ({settings: DEFAULT_SETTINGS,
  pages: [makePage({id:'page-1', url:'https://example.com/jobs', name:'Jobs', mode:'fetch', enabled:false,
    intervalSeconds:900, selector:'#jobs', excludeSelectors:['nav'], ignorePatterns:['Today'],
    ignoreTimestamps:false, ignoreNumbers:true, keywords:['Remote'], keywordMode:'added',
    threshold:2, tags:['Work'], notifications:false, faviconUrl:'https://example.com/icon.svg'})],
  changes: [{id:'change-1',pageId:'page-1',runId:'run-1',timestamp:123,before:'Old role',after:'New role',size:6,percent:20,matchedKeywords:['Remote'],read:true,filtered:false}],
  runs: [{id:'run-1',startedAt:120,endedAt:124,status:'complete',source:'manual',queue:['page-1'],total:1,completed:1,changed:1,errors:0}],
  checks: [{id:'change-1',pageId:'page-1',runId:'run-1',timestamp:123,status:'changed',title:'Jobs',characters:8,percent:20}],
});

test('Evans workspace archive round-trips capture rules, evidence, review state and run relationships', () => {
  const original=fixture(), archive=JSON.parse(JSON.stringify(createArchive(original,date)));
  assert.deepEqual(Object.keys(archive),['schema','schemaVersion','createdAt','workspace','journal']);
  assert.equal(archive.schema,ARCHIVE_SCHEMA);
  const result=prepareImport(archive), page=result.pages[0];
  for (const key of ['url','name','mode','enabled','intervalSeconds','selector','excludeSelectors','ignorePatterns','ignoreTimestamps','ignoreNumbers','keywords','keywordMode','threshold','tags','notifications','faviconUrl','createdAt']) assert.deepEqual(page[key],original.pages[0][key],key);
  assert.notEqual(page.id,'page-1');
  assert.equal(result.changes[0].pageId,page.id);
  assert.equal(result.checks[0].pageId,page.id);
  assert.deepEqual(result.runs[0].queue,[page.id]);
  assert.equal(result.changes[0].runId,result.runs[0].id);
  assert.equal(result.changes[0].read,true);
  assert.equal(result.changes[0].before,'Old role');
  assert.equal(result.changes[0].after,'New role');
  assert.equal(page.lastStatus,'pending');
  const again=prepareImport(archive,result.pages);
  assert.equal(again.pages.length,0); assert.equal(again.duplicates,1);
  assert.equal(again.changes[0].id,result.changes[0].id);
  assert.equal(again.checks[0].pageId,page.id);
  assert.equal(again.runs[0].queue[0],page.id);
  assert.equal(archive.workspace.preferences.appearance,DEFAULT_SETTINGS.theme);
});

test('old Evans backups are read-only compatibility inputs, and HTML is converted before storage or export',()=>{
  const older={format:'evans',version:1,exportedAt:date,...fixture()};
  older.changes[0]={...older.changes[0],before:'same',after:'same',legacyDiff:'Jobs <del>Old</del><ins>New &amp; Remote<img src="https://invalid.test/track"></ins><script>bad()</script>'};
  const imported=prepareImport(older);
  assert.deepEqual(changeDocuments(imported.changes[0]),{before:'Jobs Old',after:'Jobs New & Remote'});
  assert.equal('legacyDiff' in imported.changes[0],false);
  const archive=createArchive({...fixture(),changes:older.changes},date);
  assert.deepEqual(archive.journal.revisions[0].documents,{earlier:'Jobs Old',later:'Jobs New & Remote'});
  assert.doesNotMatch(JSON.stringify(archive),/legacyDiff|diffHtml|previousContent|currentContent|jobId|selectorType|sensitivity|invalid\.test|bad\(\)/);
});

test('legacy job exports import text history without using it as a baseline', () => {
  const original = {exportedAt: date,
    jobs: [{id: 'job-1', url: 'https://example.com/jobs', name: 'Example jobs'}],
    changes: [{id: 'change-1', jobId: 'job-1', timestamp: 123,
      diffHtml: 'Jobs <del>Old role</del><ins>New role</ins>'}],
  };
  const imported = prepareImport(original);
  assert.equal(imported.pages.length, 1);
  assert.equal(imported.changes.length, 1);
  const [page] = imported.pages;
  const [change] = imported.changes;
  assert.equal(page.lastStatus, 'pending');
  assert.equal(page.lastCheckedAt, null);
  assert.equal(page.unread, 1);
  assert.equal(change.pageId, page.id);
  assert.deepEqual(changeDocuments(change), {before: 'Jobs Old role', after: 'Jobs New role'});
  assert.equal('legacyDiff' in change, false);
  const repeated = prepareImport(original, imported.pages);
  assert.equal(repeated.duplicates, 1);
  assert.equal(repeated.pages.length, 0);
  assert.equal(repeated.changes[0].pageId, page.id);
});

test('archives reject unknown schemas, versions, broken source references and malformed text before import',()=>{
  assert.throws(()=>decodeArchive({schema:'another-app'}));
  assert.throws(()=>decodeArchive({...createArchive(fixture()),schemaVersion:99}));
  assert.throws(()=>prepareImport({format:'evans',version:99,pages:[]}));
  assert.throws(()=>decodeArchive({schema:ARCHIVE_SCHEMA,schemaVersion:2}));
  const broken=createArchive(fixture()); broken.journal.revisions[0].source='missing';
  assert.throws(()=>prepareImport(broken),/missing source/);
  const duplicate=createArchive(fixture()); duplicate.workspace.sources.push(duplicate.workspace.sources[0]);
  assert.throws(()=>prepareImport(duplicate),/unique/);
  const markup=createArchive(fixture()); markup.journal.revisions[0].documents.earlier={html:'bad'};
  assert.throws(()=>prepareImport(markup),/plain text/);
  const invalid=createArchive(fixture());invalid.workspace.sources[0].address='javascript:alert(1)';
  assert.throws(()=>prepareImport(invalid),/HTTP/);
});

test('interrupted imported sessions become stopped without resuming old work',()=>{
  const original=fixture(); original.runs[0].status='running';
  assert.equal(prepareImport(createArchive(original)).runs[0].status,'cancelled');
});

test('upgrading installed history preserves IDs, reading state and relations while discarding foreign markup',()=>{
  const existing={...fixture().changes[0],legacyDiff:'<del>Earlier</del><ins>Later</ins>',previousContent:'wrong',currentContent:'wrong'};
  const clean=plainHistoryRecord(existing);
  for(const key of ['id','pageId','runId','timestamp','read','filtered']) assert.deepEqual(clean[key],existing[key]);
  assert.equal(clean.before,'Earlier'); assert.equal(clean.after,'Later');
  for(const key of ['legacyDiff','diffHtml','previousContent','currentContent']) assert.equal(key in clean,false);
  assert.deepEqual(plainHistoryRecord(clean),clean);
});
