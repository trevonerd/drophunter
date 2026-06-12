import { describe, expect, test } from 'bun:test';
import { computeVirtualWindow } from '../src/popup/hooks/virtual-rows-compute.ts';

function makeOffsets(heights: number[]): number[] {
  const offsets = new Array<number>(heights.length + 1);
  offsets[0] = 0;
  for (let i = 0; i < heights.length; i++) {
    offsets[i + 1] = (offsets[i] ?? 0) + (heights[i] ?? 0);
  }
  return offsets;
}

describe('computeVirtualWindow', () => {
  test('empty rows returns empty window', () => {
    const result = computeVirtualWindow([0], 0, 200);
    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(-1);
    expect(result.totalHeight).toBe(0);
  });

  test('window at scrollTop 0 includes first rows plus overscan', () => {
    const heights = Array(20).fill(44);
    const offsets = makeOffsets(heights);
    const result = computeVirtualWindow(offsets, 0, 200, 2);
    expect(result.startIndex).toBe(0);
    const visibleRows = Math.ceil(200 / 44);
    expect(result.endIndex).toBe(Math.min(19, visibleRows - 1 + 2));
    expect(result.totalHeight).toBe(20 * 44);
  });

  test('mid-scroll window with mixed 28/44px heights is correct', () => {
    const heights = [28, 44, 44, 44, 44, 28, 44, 44, 44, 44, 28, 44, 44, 44, 44];
    const offsets = makeOffsets(heights);
    const scrollTop = 200;
    const viewportHeight = 150;
    const result = computeVirtualWindow(offsets, scrollTop, viewportHeight, 0);

    for (let i = result.startIndex; i <= result.endIndex; i++) {
      const rowBottom = offsets[i + 1] ?? 0;
      const rowTop = offsets[i] ?? 0;
      const isVisible = rowBottom > scrollTop && rowTop < scrollTop + viewportHeight;
      expect(isVisible).toBe(true);
    }

    if (result.startIndex > 0) {
      const prevBottom = offsets[result.startIndex] ?? 0;
      expect(prevBottom <= scrollTop).toBe(true);
    }
  });

  test('overscan expands window beyond visible rows', () => {
    const heights = Array(30).fill(44);
    const offsets = makeOffsets(heights);
    const scrollTop = 10 * 44;
    const viewportHeight = 3 * 44;
    const resultNoOverscan = computeVirtualWindow(offsets, scrollTop, viewportHeight, 0);
    const resultWithOverscan = computeVirtualWindow(offsets, scrollTop, viewportHeight, 4);
    expect(resultWithOverscan.startIndex).toBe(Math.max(0, resultNoOverscan.startIndex - 4));
    expect(resultWithOverscan.endIndex).toBe(Math.min(29, resultNoOverscan.endIndex + 4));
  });

  test('overscan clamped at start', () => {
    const heights = Array(20).fill(44);
    const offsets = makeOffsets(heights);
    const result = computeVirtualWindow(offsets, 44, 100, 10);
    expect(result.startIndex).toBe(0);
  });

  test('overscan clamped at end', () => {
    const heights = Array(5).fill(44);
    const offsets = makeOffsets(heights);
    const result = computeVirtualWindow(offsets, 0, 100, 10);
    expect(result.endIndex).toBe(4);
  });

  test('totalHeight is sum of all row heights', () => {
    const heights = [28, 44, 44, 28, 44];
    const offsets = makeOffsets(heights);
    const result = computeVirtualWindow(offsets, 0, 200);
    expect(result.totalHeight).toBe(28 + 44 + 44 + 28 + 44);
  });

  test('single row is included in window', () => {
    const offsets = makeOffsets([44]);
    const result = computeVirtualWindow(offsets, 0, 200, 0);
    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(0);
  });
});
