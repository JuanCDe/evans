import {diffLines, diffWords, diffText, textLines} from './diff.js';
import {textDocuments} from './import-compat.js';

// Older installed records remain readable while their one-time upgrade completes.
export const changeDocuments = textDocuments;
export function buildComparison(change) {
  const {before, after} = changeDocuments(change), parts = diffLines(before, after), rows = [];
  let beforeLine = 1, afterLine = 1;
  for (let i = 0; i < parts.length;) {
    if (parts[i].type === 'equal') {
      for (const text of textLines(parts[i++].text)) {
        rows.push({changed:false, beforeLine:beforeLine++, afterLine:afterLine++, before:[{type:'equal',text}], after:[{type:'equal',text}]});
      }
      continue;
    }
    let oldText = '', newText = '';
    while (i < parts.length && parts[i].type !== 'equal') {
      const part = parts[i++];
      if (part.type === 'remove') oldText += part.text; else newText += part.text;
    }
    const oldLines = textLines(oldText), newLines = textLines(newText);
    for (let j = 0; j < Math.max(oldLines.length, newLines.length); j++) {
      const hasBefore = j < oldLines.length, hasAfter = j < newLines.length;
      const diff = diffWords(oldLines[j] || '', newLines[j] || '');
      rows.push({changed:true, beforeLine:hasBefore ? beforeLine++ : null, afterLine:hasAfter ? afterLine++ : null,
        before:diff.filter(p => p.type !== 'add'), after:diff.filter(p => p.type !== 'remove')});
    }
  }
  const hunks = [];
  rows.forEach((row, index) => {
    if (!row.changed) return;
    const start = Math.max(0, index - 1), end = Math.min(rows.length, index + 2), last = hunks.at(-1);
    if (last && start <= last.end) last.end = end;
    else hunks.push({start, end});
  });
  const diff = diffText(before, after), edits = diff.filter(p => p.type !== 'equal' && p.text.trim());
  const strongest = [...edits].sort((a,b) => b.text.trim().length - a.text.trim().length)[0];
  return {rows, hunks, diff, size:diff.filter(p => p.type !== 'equal').reduce((n,p) => n + p.text.length,0),
    excerpt:strongest ? `${strongest.type === 'add' ? '+ ' : '− '}${strongest.text.trim()}` : 'No text differences',
    added:rows.filter(r => r.changed && r.afterLine !== null).length,
    removed:rows.filter(r => r.changed && r.beforeLine !== null).length};
}
