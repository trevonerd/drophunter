import { describe, expect, test } from 'bun:test';

function normalizeText(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim();
}

function extractCategorySlugFromHref(href: string): string | null {
  const match = href.match(/\/directory\/category\/([^/?#]+)/);
  return match?.[1] ?? null;
}

function normalizeForCompare(value: string): string {
  const lower = value.toLowerCase();
  const normalized = lower.normalize('NFD');
  return normalized
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

interface FakeElement {
  textContent?: string | null;
  href?: string;
  attributes: Record<string, string>;
  getAttribute(name: string): string | null;
}

function createFakeLinkElement(options: {
  textContent?: string;
  href?: string;
  attributes?: Record<string, string>;
} = {}): FakeElement {
  return {
    textContent: options.textContent ?? '',
    href: options.href ?? '',
    attributes: { href: options.href ?? '', ...options.attributes },
    getAttribute(name: string) {
      return this.attributes[name] ?? null;
    },
  };
}

function createFakeTitleElement(options: { textContent?: string | null } = {}): FakeElement {
  return {
    textContent: options.textContent ?? null,
    attributes: {},
    getAttribute() { return null; },
  };
}

interface FakeRoot {
  querySelectorAll(selector: string): FakeElement[];
  querySelector(selector: string): FakeElement | null;
}

function createFakeDocument(
  allElements: Record<string, FakeElement[]>,
  singleElements: Record<string, FakeElement | null> = {},
): FakeRoot {
  return {
    querySelectorAll(selector: string): FakeElement[] {
      return allElements[selector] ?? [];
    },
    querySelector(selector: string): FakeElement | null {
      return singleElements[selector] ?? null;
    },
  };
}

function extractStreamCategoryFromDoc(doc: FakeRoot): { slug: string; label: string } {
  const links = doc.querySelectorAll('a[data-a-target="stream-game-link"], a[href*="/directory/category/"]');
  for (const link of links) {
    const href = link.getAttribute('href') ?? '';
    const slug = extractCategorySlugFromHref(href);
    if (!slug) continue;
    const label = normalizeText(link.textContent) || slug.replace(/-/g, ' ');
    return { slug, label };
  }
  return { slug: '', label: '' };
}

function extractStreamTitleFromDoc(doc: FakeRoot, docTitle = ''): string {
  const titleNode = doc.querySelector(
    '[data-a-target="stream-title"], h2[data-a-target="stream-title"], h1[data-a-target="stream-title"], h1',
  );
  const fromNode = normalizeText(titleNode?.textContent);
  if (fromNode) return fromNode;
  return normalizeText(docTitle.replace(/\s*-\s*Twitch.*$/i, ''));
}

describe('normalizeText', () => {
  test('collapses multiple whitespace into single space and trims', () => {
    expect(normalizeText('  hello   world  ')).toBe('hello world');
  });

  test('returns empty string for null', () => {
    expect(normalizeText(null)).toBe('');
  });

  test('returns empty string for undefined', () => {
    expect(normalizeText(undefined)).toBe('');
  });

  test('passes through a clean string unchanged', () => {
    expect(normalizeText('hello world')).toBe('hello world');
  });
});

describe('extractCategorySlugFromHref', () => {
  test('extracts slug from a valid category URL', () => {
    expect(extractCategorySlugFromHref('/directory/category/world-of-warcraft')).toBe('world-of-warcraft');
  });

  test('returns null when URL does not contain category path', () => {
    expect(extractCategorySlugFromHref('/streams')).toBeNull();
  });

  test('returns null for an empty string', () => {
    expect(extractCategorySlugFromHref('')).toBeNull();
  });

  test('stops at query string boundary', () => {
    expect(extractCategorySlugFromHref('/directory/category/rust?sort=recent')).toBe('rust');
  });

  test('stops at fragment boundary', () => {
    expect(extractCategorySlugFromHref('/directory/category/apex-legends#top')).toBe('apex-legends');
  });
});

describe('normalizeForCompare', () => {
  test('lowercases and strips accents', () => {
    expect(normalizeForCompare('Héros')).toBe('heros');
  });

  test('replaces non-alphanumeric sequences with single space', () => {
    expect(normalizeForCompare('Drops: Enabled!')).toBe('drops enabled');
  });

  test('trims leading and trailing spaces', () => {
    expect(normalizeForCompare('  hello  ')).toBe('hello');
  });
});

describe('extractStreamCategory with FakeElement', () => {
  test('returns slug and label from a matching category link', () => {
    const link = createFakeLinkElement({
      textContent: 'World of Warcraft',
      attributes: { href: '/directory/category/world-of-warcraft' },
    });
    const doc = createFakeDocument({
      'a[data-a-target="stream-game-link"], a[href*="/directory/category/"]': [link],
    });

    const result = extractStreamCategoryFromDoc(doc);
    expect(result.slug).toBe('world-of-warcraft');
    expect(result.label).toBe('World of Warcraft');
  });

  test('returns empty slug and label when no category links are found (null DOM element scenario)', () => {
    const doc = createFakeDocument({});
    const result = extractStreamCategoryFromDoc(doc);
    expect(result.slug).toBe('');
    expect(result.label).toBe('');
  });

  test('skips links with no extractable slug and falls through to empty', () => {
    const link = createFakeLinkElement({
      textContent: 'Just a link',
      attributes: { href: '/streams' },
    });
    const doc = createFakeDocument({
      'a[data-a-target="stream-game-link"], a[href*="/directory/category/"]': [link],
    });

    const result = extractStreamCategoryFromDoc(doc);
    expect(result.slug).toBe('');
  });

  test('derives label from slug when textContent is empty', () => {
    const link = createFakeLinkElement({
      textContent: '',
      attributes: { href: '/directory/category/apex-legends' },
    });
    const doc = createFakeDocument({
      'a[data-a-target="stream-game-link"], a[href*="/directory/category/"]': [link],
    });

    const result = extractStreamCategoryFromDoc(doc);
    expect(result.slug).toBe('apex-legends');
    expect(result.label).toBe('apex legends');
  });
});

describe('extractStreamTitle with FakeElement', () => {
  test('returns textContent from a stream-title element when present', () => {
    const titleEl = createFakeTitleElement({ textContent: '  Drops Enabled Stream  ' });
    const doc = createFakeDocument({}, {
      '[data-a-target="stream-title"], h2[data-a-target="stream-title"], h1[data-a-target="stream-title"], h1': titleEl,
    });

    const result = extractStreamTitleFromDoc(doc, 'Page Title - Twitch');
    expect(result).toBe('Drops Enabled Stream');
  });

  test('falls back to document.title when stream-title element is missing (null DOM element scenario)', () => {
    const doc = createFakeDocument({}, {});
    const result = extractStreamTitleFromDoc(doc, 'Some Stream - Twitch');
    expect(result).toBe('Some Stream');
  });

  test('returns empty string when both stream-title element and document.title are empty', () => {
    const doc = createFakeDocument({}, {});
    const result = extractStreamTitleFromDoc(doc, '');
    expect(result).toBe('');
  });

  test('null textContent on title element falls back to document.title', () => {
    const titleEl = createFakeTitleElement({ textContent: null });
    const doc = createFakeDocument({}, {
      '[data-a-target="stream-title"], h2[data-a-target="stream-title"], h1[data-a-target="stream-title"], h1': titleEl,
    });

    const result = extractStreamTitleFromDoc(doc, 'Streamer Name - Twitch');
    expect(result).toBe('Streamer Name');
  });
});
