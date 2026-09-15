type StreamCategory = {
  readonly categorySlug?: string | null;
  readonly categoryLabel?: string | null;
};

type ExpectedCategory = {
  readonly categorySlug?: string;
  readonly categoryName?: string;
};

function normalized(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

export function isExpectedStreamCategory(
  observed: StreamCategory | null,
  expected: ExpectedCategory,
): boolean {
  if (!observed) return false;
  const slug = normalized(observed.categorySlug);
  const expectedSlug = normalized(expected.categorySlug);
  if (slug && expectedSlug && slug === expectedSlug) return true;
  const label = normalized(observed.categoryLabel);
  const name = normalized(expected.categoryName);
  return label.length > 0 && name.length > 0 && label === name;
}
