import test from 'node:test';
import assert from 'node:assert/strict';
import {diffText, analyzeChange} from '../extension/core/diff.js';
import {buildComparison, changeDocuments} from '../extension/core/comparison.js';
import {renderDiff} from '../extension/ui/comparison.js';
const roles = Array.from({length: 64}, (_, i) =>
  `Engineering\nEngineer ${i + 1}\nEngineering · Remote · Full time\n`);
const removedRole = 'Sales\nAccount Executive (EMEA)\nSales • Remote, EMEA; Europe • Full time\n';
const before = '65 openings\n' + roles.slice(0, 35).join('') + removedRole + roles.slice(35).join('');
const after = '64 openings\n' + roles.join('');
function reconstruct(parts, side) { return parts.filter(p=>p.type!==(side==='before'?'add':'remove')).map(p=>p.text).join(''); }

test('long job listing isolates the count and removed role without marking unchanged jobs',()=>{
  const diff=diffText(before,after), edits=diff.filter(p=>p.type!=='equal');
  assert.deepEqual(edits,[{type:'remove',text:'65'},{type:'add',text:'64'},{type:'remove',text:'Sales\nAccount Executive (EMEA)\nSales • Remote, EMEA; Europe • Full time\n'}]);
  assert.equal(reconstruct(diff,'before'),before);assert.equal(reconstruct(diff,'after'),after);
  assert.equal(analyzeChange(before,after,{keywords:['Engineer']}).relevant,false);
  assert.equal(analyzeChange(before,after,{keywords:['Account Executive'],keywordMode:'removed'}).relevant,true);
  assert.equal(analyzeChange(before,after,{threshold:10}).relevant,false);
  const model=buildComparison({before,after});
  assert.equal(model.hunks.length,2);assert.equal(model.size,76);
  assert.equal(model.added,1);assert.equal(model.removed,4);
  assert.match(model.excerpt,/Account Executive/);
  assert.equal(model.rows.filter(r=>r.changed).length,4);
});
test('sparse distant changes stay precise even in a long single line',()=>{
  const common='Engineer Remote Full time '.repeat(1500);
  const a='65 '+common+'Old role',b='64 '+common+'New role',diff=diffText(a,b);
  assert.deepEqual(diff.filter(p=>p.type!=='equal'),[{type:'remove',text:'65'},{type:'add',text:'64'},{type:'remove',text:'Old'},{type:'add',text:'New'}]);
  assert.equal(reconstruct(diff,'before'),a);assert.equal(reconstruct(diff,'after'),b);
});
test('imported identical snapshots recover actual versions and refine coarse legacy markup',()=>{
  const change={before:'same snapshot',after:'same snapshot',legacyDiff:`<del>${before}</del><ins>${after}</ins>`};
  assert.deepEqual(changeDocuments(change),{before,after});
  assert.equal(buildComparison(change).size,76);
  assert.match(renderDiff(buildComparison(change),'before'),/<del>65<\/del>/);
  assert.match(renderDiff(buildComparison(change),'after'),/<ins>64<\/ins>/);
});
test('focused view keeps context, folds unchanged lines, and highlights both versions safely',()=>{
  const model=buildComparison({before,after}),html=renderDiff(model,'changes');
  assert.equal((html.match(/aria-label="Changed section"/g)||[]).length,2);
  assert.match(html,/103 unchanged lines/);assert.match(html,/<del>Account Executive \(EMEA\)<\/del>/);
  assert.match(renderDiff(model,'before'),/<del>65<\/del>/);
  const next=renderDiff(model,'after');assert.match(next,/<ins>64<\/ins>/);assert.doesNotMatch(next,/Account Executive/);
  assert.match(renderDiff(buildComparison({before:'a',after:'<img onerror="bad()">'}),'changes'),/&lt;img/);
  assert.doesNotMatch(renderDiff(buildComparison({before:'a',after:'<img onerror="bad()">'}),'changes'),/<img/);
});
test('diff reconstructs arbitrary repeated lines, empty versions, whitespace, and bounded fallbacks',()=>{
  let seed=12345;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  const choices=['a','b','c',' ','\n','\r\n','€','工程師','🙂'];
  for(let n=0;n<400;n++){
    const text=()=>Array.from({length:random()%150},()=>choices[random()%choices.length]).join('');
    const a=text(),b=text(),diff=diffText(a,b);
    assert.equal(reconstruct(diff,'before'),a);assert.equal(reconstruct(diff,'after'),b);
    const model=buildComparison({before:a,after:b});
    assert.equal(model.rows.flatMap(r=>r.before).map(p=>p.text).join(''),a);
    assert.equal(model.rows.flatMap(r=>r.after).map(p=>p.text).join(''),b);
  }
  for(const [a,b] of [['','new'],['old',''],['same','same'],['a\n','a'],['alpha '.repeat(2000),'beta '.repeat(2000)]]){
    const diff=diffText(a,b);assert.equal(reconstruct(diff,'before'),a);assert.equal(reconstruct(diff,'after'),b);
  }
});
test('complete version views remain available for unchanged or empty documents',()=>{
  const same=buildComparison({before:'Unchanged page',after:'Unchanged page'});
  assert.match(renderDiff(same,'changes'),/No text differences/);
  assert.match(renderDiff(same,'before'),/Unchanged page/);
  assert.match(renderDiff(same,'after'),/Unchanged page/);
  assert.match(renderDiff(buildComparison({before:'old',after:''}),'after'),/This version is empty/);
  const long=buildComparison({before:'old '+('same '.repeat(100)),after:'new '+('same '.repeat(100))});
  assert.match(renderDiff(long,'changes'),/diff-inline-gap/);
  assert.doesNotMatch(renderDiff(long,'before'),/diff-inline-gap/);
});
