import test from 'node:test';
import assert from 'node:assert/strict';
import {adjacentPageChange} from '../extension/ui/navigation.js';

const pages=['a','b','empty','c'].map(id=>({id}));
const changes=[{id:'a-new',pageId:'a'},{id:'a-old',pageId:'a'},{id:'b-new',pageId:'b'},{id:'c-new',pageId:'c'}];

test('page navigation skips repeated revisions and opens the latest change for each page',()=>{
  assert.equal(adjacentPageChange(pages,changes,'a',1).id,'b-new');
  assert.equal(adjacentPageChange(pages,changes,'b',-1).id,'a-new');
  assert.equal(adjacentPageChange(pages,changes,'b',1).id,'c-new');
});
test('page navigation respects matching evidence and does not wrap at either boundary',()=>{
  assert.equal(adjacentPageChange(pages,changes,'a',-1),undefined);
  assert.equal(adjacentPageChange(pages,changes,'c',1),undefined);
  assert.equal(adjacentPageChange(pages,changes.filter(c=>c.pageId!=='b'),'a',1).id,'c-new');
  assert.equal(adjacentPageChange(pages,changes.filter(c=>c.pageId!=='a'),'a',1).id,'b-new');
  assert.equal(adjacentPageChange(pages,[],'a',1),undefined);
});
