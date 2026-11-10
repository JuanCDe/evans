import {buildComparison} from '../core/comparison.js';
const cache = new WeakMap();
export function comparisonFor(change) {
  if (!cache.has(change)) cache.set(change, buildComparison(change));
  return cache.get(change);
}
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
function fragments(parts, focused = false) {
  return parts.map((p, index) => {
    if (focused && p.type === 'equal' && p.text.length > 240) {
      const lead = index > 0 || parts.length === 1 ? 80 : 0;
      const tail = index < parts.length - 1 ? 80 : 0;
      const end = p.text.length - tail, hidden = p.text.slice(lead,end);
      return esc(p.text.slice(0,lead)) + `<details class="diff-inline-gap"><summary>… ${hidden.length} unchanged characters</summary><span>${esc(hidden)}</span></details>` + esc(p.text.slice(end).replace(/\r?\n$/, ''));
    }
    const text = esc(p.text.replace(/\r?\n$/, ''));
    return p.type === 'equal' ? text : `<${p.type === 'add' ? 'ins' : 'del'}>${text || '<span class="sr-only">Line break changed</span>↵'}</${p.type === 'add' ? 'ins' : 'del'}>`;
  }).join('');
}
function line(row, side, focused = false) {
  const number = row[`${side}Line`], type = side === 'before' ? 'remove' : 'add';
  if (number === null) return '<div class="diff-line missing"><span aria-label="No corresponding line">—</span></div>';
  const changed = row.changed;
  return `<div class="diff-line ${changed ? type : 'context'}"><span class="diff-line-number" aria-hidden="true">${number}</span><span class="diff-line-sign" aria-hidden="true">${changed ? side === 'before' ? '−' : '+' : ''}</span><div class="diff-line-text">${fragments(row[side],focused) || ' '}</div></div>`;
}
function pair(rows) {
  return `<div class="diff-pair">${['before','after'].map(side => `<section class="diff-side" aria-label="${side === 'before' ? 'Before' : 'After'}"><h3>${side === 'before' ? 'Before' : 'After'}</h3>${rows.map(row => line(row,side,true)).join('')}</section>`).join('')}</div>`;
}
function unified(rows) {
  return rows.map(row => row.changed ? (row.beforeLine !== null ? line(row,'before') : '') + (row.afterLine !== null ? line(row,'after') : '') : line(row,'after')).join('');
}
function gap(rows) {
  if (!rows.length) return '';
  return `<details class="diff-gap"><summary>${rows.length} unchanged ${rows.length === 1 ? 'line' : 'lines'}</summary><div class="diff-expanded-context">${unified(rows)}</div></details>`;
}
export function renderDiff(comparison, mode) {
  const {rows,hunks} = comparison;
  if (mode === 'before' || mode === 'after') return rows.filter(row => row[`${mode}Line`] !== null).map(row => line(row, mode)).join('') || '<p class="diff-empty">This version is empty.</p>';
  if (!hunks.length) return '<p class="diff-empty">No text differences between these versions.</p>';
  if (mode === 'diff') return unified(rows);
  let end = 0, body = '';
  for (const hunk of hunks) {
    body += gap(rows.slice(end,hunk.start));
    body += `<section class="diff-hunk" aria-label="Changed section">${pair(rows.slice(hunk.start,hunk.end))}</section>`;
    end = hunk.end;
  }
  return body + gap(rows.slice(end));
}
