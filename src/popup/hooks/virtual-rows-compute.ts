export interface VirtualWindow {
  startIndex: number;
  endIndex: number;
  totalHeight: number;
}

export function computeVirtualWindow(
  rowOffsets: number[],
  scrollTop: number,
  viewportHeight: number,
  overscan = 6,
): VirtualWindow {
  const count = rowOffsets.length - 1;
  const totalHeight = rowOffsets[count] ?? 0;
  if (count === 0) return { startIndex: 0, endIndex: -1, totalHeight };

  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((rowOffsets[mid + 1] ?? 0) <= scrollTop) lo = mid + 1;
    else hi = mid;
  }
  const firstVisible = lo;

  let last = firstVisible;
  const bottom = scrollTop + viewportHeight;
  while (last < count - 1 && (rowOffsets[last + 1] ?? 0) < bottom) last++;

  const startIndex = Math.max(0, firstVisible - overscan);
  const endIndex = Math.min(count - 1, last + overscan);
  return { startIndex, endIndex, totalHeight };
}
