// Use the first appearance of each page in the sidebar's change history.
export function adjacentPageChange(changes, currentPageId, direction) {
  const latest = new Map();
  for (const change of changes) if (!latest.has(change.pageId)) latest.set(change.pageId, change);
  const available = [...latest.keys()];
  if (!available.length) return;
  const index = available.indexOf(currentPageId);
  const targetIndex = direction > 0
    ? (index + 1) % available.length
    : index < 0 ? available.length - 1 : index - 1;
  const target = available[targetIndex];
  return latest.get(target);
}
