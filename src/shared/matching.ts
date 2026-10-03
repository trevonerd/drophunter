export function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokenOverlapScore(left: string, right: string): number {
  const leftTokens = new Set(
    normalizeToken(left)
      .split(' ')
      .filter((token) => token.length >= 3),
  );
  const rightTokens = new Set(
    normalizeToken(right)
      .split(' ')
      .filter((token) => token.length >= 3),
  );
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }
  let overlap = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  });
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}
