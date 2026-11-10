// Follow the page selector's order, skipping pages without matching evidence.
// A page can have many revisions; page navigation always opens its latest one.
export function adjacentPageChange(pages, changes, currentPageId, direction) {
  const latest = new Map();
  for (const change of changes) if (!latest.has(change.pageId)) latest.set(change.pageId, change);
  const available = pages.filter(p => latest.has(p.id) || p.id === currentPageId);
  const index = available.findIndex(p => p.id === currentPageId);
  const target = available[index < 0 ? (direction > 0 ? 0 : available.length - 1) : index + direction];
  return target && latest.get(target.id);
}
