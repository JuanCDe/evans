import test from 'node:test';
import assert from 'node:assert/strict';
import {adjacentPageChange} from '../extension/ui/navigation.js';

const changes=[{id:'a-new',pageId:'a'},{id:'a-old',pageId:'a'},{id:'b-new',pageId:'b'},{id:'c-new',pageId:'c'}];

test('page navigation skips repeated revisions and opens the latest change for each page',()=>{
  assert.equal(adjacentPageChange(changes,'a',1).id,'b-new');
  assert.equal(adjacentPageChange(changes,'b',-1).id,'a-new');
  assert.equal(adjacentPageChange(changes,'b',1).id,'c-new');
});
test('page navigation respects matching evidence and does not wrap at either boundary',()=>{
  assert.equal(adjacentPageChange(changes,'a',-1),undefined);
  assert.equal(adjacentPageChange(changes,'c',1),undefined);
  assert.equal(adjacentPageChange(changes.filter(c=>c.pageId!=='b'),'a',1).id,'c-new');
  assert.equal(adjacentPageChange(changes.filter(c=>c.pageId!=='a'),null,1).id,'b-new');
  assert.equal(adjacentPageChange([],'a',1),undefined);
});

test('next follows the sidebar from Delta to Alpha and Beta', () => {
  const delta = {id:'delta-new', pageId:'delta'};
  const alpha = {id:'alpha-new', pageId:'alpha'};
  const beta = {id:'beta-new', pageId:'beta'};
  const history = [delta, alpha, {...delta, id:'delta-old'}, beta];
  assert.equal(adjacentPageChange(history, 'delta', 1), alpha);
  assert.equal(adjacentPageChange(history, 'alpha', 1), beta);
  assert.equal(adjacentPageChange(history, 'beta', -1), alpha);
});
