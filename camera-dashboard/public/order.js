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
