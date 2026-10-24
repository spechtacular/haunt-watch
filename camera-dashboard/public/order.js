// Reconcile saved camera IDs with today's configuration, preserving new cameras.
export function restoreOrder(cameras, saved) {
  if (!Array.isArray(saved)) return [...cameras];
  const remaining = new Map(cameras.map(camera => [camera.id, camera]));
  const ordered = [];
  for (const id of saved) {
    if (remaining.has(id)) {
      ordered.push(remaining.get(id));
      remaining.delete(id);
    }
  }
  return [...ordered, ...remaining.values()];
}

export function moveCamera(cameras, sourceId, targetId) {
  const source = cameras.findIndex(camera => camera.id === sourceId);
  const target = cameras.findIndex(camera => camera.id === targetId);
  const result = [...cameras];
  if (source < 0 || target < 0 || source === target) return result;
  result.splice(target, 0, ...result.splice(source, 1));
  return result;
}

export function pageSize(value) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 1 && count <= 6 ? count : 6;
}

export function cameraPage(cameras, requestedPage, requestedSize) {
  const size = pageSize(requestedSize);
  const pages = Math.max(1, Math.ceil(cameras.length / size));
  const page = Math.max(0, Math.min(Number.isInteger(requestedPage) ? requestedPage : 0, pages - 1));
  return { size, pages, page, visible: cameras.slice(page * size, (page + 1) * size) };
}

// Stored pages contain camera IDs only; removed cameras must not break the wall.
export function restoreGroups(value, cameras) {
  if (!Array.isArray(value)) return [];
  const available = new Set(cameras.map(camera => camera.id));
  const seen = new Set();
  return value.flatMap(group => {
    if (!group || typeof group.id !== 'string' || !/^[\w-]+$/.test(group.id) || seen.has(group.id) ||
      typeof group.name !== 'string' || !group.name.trim() || !Array.isArray(group.cameras)) return [];
    seen.add(group.id);
    return [{ id: group.id, name: group.name.trim().slice(0, 60),
      cameras: [...new Set(group.cameras.filter(id => available.has(id)))].slice(0, 6) }];
  });
}

export function validateGroup(name, selectedIds, groups, editingId = null) {
  if (!name.trim() || name.trim().length > 60) return 'Enter a page name between 1 and 60 characters.';
  if (groups.some(group => group.id !== editingId && group.name.toLowerCase() === name.trim().toLowerCase())) return 'A page with that name already exists.';
  if (selectedIds.length < 1 || selectedIds.length > 6 || new Set(selectedIds).size !== selectedIds.length) return 'Select between 1 and 6 different cameras.';
  return '';
}
