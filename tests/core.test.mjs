import test from 'node:test';
import assert from 'node:assert/strict';
import {diffText, analyzeChange} from '../extension/core/diff.js';
import {makePage, prepareImport, parseBulk, canonicalUrl, validUrl} from '../extension/core/model.js';
import {legacyTokens} from '../extension/core/legacy.js';

test('the word diff reconstructs both documents exactly, including Unicode and whitespace',()=>{
  const pairs=[['',''],['hello',''],['','new'],['Ingeniero remoto\nMadrid','Ingeniera remota\nBilbao'],['a b a b','b a b a'],['价 格 20 €','价 格 25 €'],['same content','same content']];
  for(let n=0;n<80;n++)pairs.push([Array.from({length:n},(_,i)=>['one','two','three','\n'][i%4]).join(' '),Array.from({length:n+2},(_,i)=>['one','three','four','\n'][i%4]).join(' ')]);
  pairs.push(['alpha '.repeat(2000),'beta '.repeat(2000)]);
  for(const [before,after] of pairs){const d=diffText(before,after);assert.equal(d.filter(t=>t.type!=='add').map(t=>t.text).join(''),before);assert.equal(d.filter(t=>t.type!=='remove').map(t=>t.text).join(''),after);}
});
test('keyword filters distinguish additions and removals and respect threshold',()=>{
  const p={keywords:['engineer'],keywordMode:'added',threshold:0};
  assert.equal(analyzeChange('Careers','Careers remote ENGINEER',p).relevant,true);
  assert.equal(analyzeChange('Careers engineer','Careers',p).relevant,false);
  assert.equal(analyzeChange('Careers engineer','Careers',{...p,keywordMode:'removed'}).relevant,true);
  assert.equal(analyzeChange('a'.repeat(500)+' x','a'.repeat(500)+' y',{threshold:10}).relevant,false);
  assert.equal(analyzeChange('same','same',{}).relevant,false);
});
test('bulk import handles titles, duplicate URLs, and line errors without silently discarding them',()=>{
  const result=parseBulk('Example jobs | https://example.com/careers\nhttps://example.org\ninvalid\n');
  assert.equal(result.entries.length,2);assert.equal(result.entries[0].name,'Example jobs');assert.equal(result.invalid[0].line,3);
  assert.equal(canonicalUrl('https://example.org/#jobs'),canonicalUrl('https://example.org'));
  assert.throws(()=>validUrl('javascript:alert(1)'));assert.throws(()=>validUrl('https://user:secret@example.com'));
});
test('Evans backups retain filtered/read states and remap page and run relations',()=>{
  const result=prepareImport({format:'evans',exportedAt:'2026-10-30',pages:[{id:'p',url:'https://example.com',name:'Example'}],changes:[{id:'c',pageId:'p',runId:'r',before:'one',after:'two',filtered:true,read:false}]});
  assert.equal(result.changes[0].pageId,result.pages[0].id);assert.equal(result.changes[0].originalRunId,'r');assert.equal(result.changes[0].read,true);assert.equal(result.changes[0].filtered,true);assert.equal(result.pages[0].unread,0);
});
test('page settings use local modes, permit unlimited page arrays and enforce a one-minute minimum',()=>{
  assert.equal(makePage({url:'https://example.com',intervalSeconds:1,mode:'cloud'}).intervalSeconds,60);
  assert.equal(makePage({url:'https://example.com',mode:'cloud'}).mode,'rendered');
  const result=prepareImport({jobs:Array.from({length:750},(_,i)=>({url:`https://example.com/page/${i}`}))});assert.equal(result.pages.length,750);
});

test('legacy diffs become inert text with only addition/removal semantics',()=>{
  const d=legacyTokens('Jobs <del onclick="bad()">Old &amp; Remote</del><ins>New &#x20ac; <img src="https://invalid.test/track" onerror="bad()"></ins><script>bad()</script><svg onload="bad()">bad()</svg>');
  assert.deepEqual(d,[{type:'equal',text:'Jobs '},{type:'remove',text:'Old & Remote'},{type:'add',text:'New € '}]);
  assert.equal(legacyTokens('<ins>&lt;script&gt;literal&lt;/script&gt;</ins>')[0].text,'<script>literal</script>');
});

test('clock and relative-time updates do not notify, substantive edits still do',()=>{
 assert.equal(analyzeChange('Jobs updated 12:30:21 · 3 minutes ago','Jobs updated 12:31:22 · 4 minutes ago',{}).relevant,false);
 assert.equal(analyzeChange('Jobs 12:30 Engineer','Jobs 12:31 Designer',{}).relevant,true);
 assert.equal(analyzeChange('Shift 12:30','Shift 13:30',{ignoreTimestamps:false}).relevant,true);
});


test('favicon metadata survives backup import and rejects non-web URLs',()=>{
  const data={format:'evans',pages:[{id:'p',url:'https://example.com/jobs',faviconUrl:'https://cdn.example.com/brand.svg'}]};
  const restored=prepareImport(data).pages[0];
  assert.equal(restored.faviconUrl,'https://cdn.example.com/brand.svg');
  for(const faviconUrl of ['javascript:alert(1)','data:image/svg+xml,unsafe','https://user:secret@example.com/icon.png'])assert.equal(makePage({url:'https://example.com',faviconUrl}).faviconUrl,'');
});
