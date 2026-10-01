export function isValidReorderPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const { fromIndex, toIndex } = payload as Record<string, unknown>;
  return (
    typeof fromIndex === 'number' &&
    typeof toIndex === 'number' &&
    Number.isInteger(fromIndex) &&
    Number.isInteger(toIndex) &&
    fromIndex >= 0 &&
    toIndex >= 0 &&
    fromIndex !== toIndex
  );
}
