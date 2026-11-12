// Use the first appearance of each page in the sidebar's change history.
export function adjacentPageChange(changes, currentPageId, direction) {
  const latest = new Map();
  for (const change of changes) if (!latest.has(change.pageId)) latest.set(change.pageId, change);
  const available = [...latest.keys()];
  const index = available.indexOf(currentPageId);
  const target = available[index < 0 ? (direction > 0 ? 0 : available.length - 1) : index + direction];
  return latest.get(target);
}
