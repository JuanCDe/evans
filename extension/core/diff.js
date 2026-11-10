export const normalizeVolatileText = s => String(s).replace(/\b\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?(?:\s*[AP]M)?\b/gi, '[time]').replace(/\b\d+\s+(seconds?|minutes?|hours?)\s+ago\b/gi, '[relative time]');
const tokens = s => s.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) || [];
export const textLines = s => String(s).match(/[^\n]*\n|[^\n]+$/g) || [];
export const normalizeText = s => String(s || '').normalize('NFKC').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
function append(result, type, text) {
  if (!text) return;
  const last = result.at(-1);
  if (last?.type === type) last.text += text;
  else result.push({type, text});
}
// Myers follows the edit distance, so distant small edits do not turn an entire
// document into a replacement. Bound work and memory for unrelated documents.
function sequenceDiff(a, b) {
  let start = 0, endA = a.length, endB = b.length;
  while (start < endA && start < endB && a[start] === b[start]) start++;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const result = [];
  append(result, 'equal', a.slice(0, start).join(''));
  const x = a.slice(start, endA), y = b.slice(start, endB);
  if (!x.length || !y.length) {
    append(result, 'remove', x.join('')); append(result, 'add', y.join(''));
  } else {
    const limit = Math.min(x.length + y.length, 1024), offset = limit + 1;
    const frontier = new Int32Array(2 * limit + 3).fill(-1), trace = [];
    frontier[offset + 1] = 0;
    let distance = -1, work = 0;
    search: for (let d = 0; d <= limit; d++) {
      trace.push(frontier.slice());
      for (let k = -d; k <= d; k += 2) {
        let i = k === -d || (k !== d && frontier[offset + k - 1] < frontier[offset + k + 1]) ? frontier[offset + k + 1] : frontier[offset + k - 1] + 1;
        let j = i - k;
        while (i < x.length && j < y.length && x[i] === y[j]) { i++; j++; work++; }
        frontier[offset + k] = i;
        if (i >= x.length && j >= y.length) { distance = d; break search; }
        if (++work > 2000000) break search;
      }
    }
    if (distance < 0) {
      append(result, 'remove', x.join('')); append(result, 'add', y.join(''));
    } else {
      const edits = []; let i = x.length, j = y.length;
      for (let d = distance; d >= 0; d--) {
        const v = trace[d], k = i - j;
        const previousK = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? k + 1 : k - 1;
        const previousI = v[offset + previousK], previousJ = previousI - previousK;
        while (i > previousI && j > previousJ) { edits.push({type:'equal', text:x[--i]}); j--; }
        if (d > 0) edits.push(i === previousI ? {type:'add', text:y[--j]} : {type:'remove', text:x[--i]});
      }
      for (const edit of edits.reverse()) append(result, edit.type, edit.text);
    }
  }
  append(result, 'equal', a.slice(endA).join(''));
  return result;
}
export const diffLines = (before, after) => sequenceDiff(textLines(before), textLines(after));
export const diffWords = (before, after) => sequenceDiff(tokens(before), tokens(after));
export function diffText(before, after) {
  const result = [], lines = diffLines(before, after);
  // Anchor on unchanged lines first, then highlight words within each edit.
  for (let i = 0; i < lines.length;) {
    if (lines[i].type === 'equal') { append(result, 'equal', lines[i++].text); continue; }
    let removed = '', added = '';
    while (i < lines.length && lines[i].type !== 'equal') {
      const part = lines[i++];
      if (part.type === 'remove') removed += part.text; else added += part.text;
    }
    for (const part of diffWords(removed, added)) append(result, part.type, part.text);
  }
  return result;
}
export function analyzeChange(before, after, page) {
  if(page.ignoreTimestamps !== false) { before=normalizeVolatileText(before); after=normalizeVolatileText(after); }
  const diff = diffText(before, after);
  const added = diff.filter(t => t.type === 'add').map(t => t.text).join(' ');
  const removed = diff.filter(t => t.type === 'remove').map(t => t.text).join(' ');
  const size = added.length + removed.length;
  const percent = Math.min(100, size / Math.max(before.length, after.length, 1) * 100);
  const haystack = (page.keywordMode === 'removed' ? removed : page.keywordMode === 'added' ? added : `${added} ${removed}`).toLocaleLowerCase();
  const matchedKeywords = (page.keywords || []).filter(k => haystack.includes(k.toLocaleLowerCase()));
  const relevant = size > 0 && percent >= (Number(page.threshold) || 0) && (!(page.keywords?.length) || matchedKeywords.length > 0);
  return { before, after, diff, added, removed, size, percent, matchedKeywords, relevant };
}
