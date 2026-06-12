import { useMemo, useState } from 'react';

export { computeVirtualWindow, type VirtualWindow } from './virtual-rows-compute.ts';

import { computeVirtualWindow } from './virtual-rows-compute.ts';

export interface VirtualRowResult<T> {
  row: T;
  index: number;
  top: number;
  height: number;
}

export function useVirtualRows<T>(options: {
  rows: T[];
  getRowHeight: (row: T) => number;
  viewportHeight: number;
  overscan?: number;
}): {
  totalHeight: number;
  visibleRows: VirtualRowResult<T>[];
  onScroll: React.UIEventHandler<HTMLDivElement>;
} {
  const { rows, getRowHeight, viewportHeight, overscan = 6 } = options;
  const [scrollTop, setScrollTop] = useState(0);

  const rowOffsets = useMemo(() => {
    const offsets = new Array<number>(rows.length + 1);
    offsets[0] = 0;
    for (let i = 0; i < rows.length; i++) {
      offsets[i + 1] = (offsets[i] ?? 0) + getRowHeight(rows[i]!);
    }
    return offsets;
  }, [rows, getRowHeight]);

  const { startIndex, endIndex, totalHeight } = useMemo(
    () => computeVirtualWindow(rowOffsets, scrollTop, viewportHeight, overscan),
    [rowOffsets, scrollTop, viewportHeight, overscan],
  );

  const visibleRows = useMemo<VirtualRowResult<T>[]>(() => {
    const result: VirtualRowResult<T>[] = [];
    for (let i = startIndex; i <= endIndex; i++) {
      const row = rows[i];
      if (row === undefined) continue;
      result.push({
        row,
        index: i,
        top: rowOffsets[i] ?? 0,
        height: getRowHeight(row),
      });
    }
    return result;
  }, [rows, rowOffsets, startIndex, endIndex, getRowHeight]);

  const onScroll: React.UIEventHandler<HTMLDivElement> = (e) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  return { totalHeight, visibleRows, onScroll };
}
