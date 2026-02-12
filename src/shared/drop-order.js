function etaOrInfinity(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : Number.POSITIVE_INFINITY;
}

function expiryOrInfinity(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

export function comparePendingDrops(a, b) {
  // Event-based (sub-only) drops always sort after time-based drops
  const aEvent = a.dropType === 'event-based' ? 1 : 0;
  const bEvent = b.dropType === 'event-based' ? 1 : 0;
  if (aEvent !== bEvent) return aEvent - bEvent;

  const etaOrder = etaOrInfinity(a.remainingMinutes) - etaOrInfinity(b.remainingMinutes);
  if (etaOrder !== 0) {
    return etaOrder;
  }

  const expiryOrder = expiryOrInfinity(a.expiresInMs) - expiryOrInfinity(b.expiresInMs);
  if (expiryOrder !== 0) {
    return expiryOrder;
  }

  if (a.progress !== b.progress) {
    return b.progress - a.progress;
  }

  return a.name.localeCompare(b.name);
}

export function sortPendingDrops(drops) {
  return [...drops].sort(comparePendingDrops);
}

export function pickNearestDrop(pendingDrops) {
  if (!Array.isArray(pendingDrops) || pendingDrops.length === 0) {
    return null;
  }
  // Exclude event-based (sub-only) drops — monitor only shows farmable drops
  const farmable = pendingDrops.filter((d) => d.dropType !== 'event-based');
  return farmable.length > 0 ? (sortPendingDrops(farmable)[0] ?? null) : null;
}
