interface CategoryLink {
  readonly textContent: string | null;
  readonly getAttribute: (name: string) => string | null;
}

interface CategoryDocument {
  readonly querySelectorAll: (selector: string) => Iterable<CategoryLink>;
}

type Category = { readonly slug: string; readonly label: string };

function categoryFromLink(link: CategoryLink): Category | null {
  try {
    const url = new URL(link.getAttribute('href') ?? '', 'https://www.twitch.tv');
    const [directory, category, slug] = url.pathname.split('/').filter(Boolean);
    if (directory !== 'directory' || category !== 'category' || !slug) return null;
    const label = (link.textContent ?? '').replace(/\s+/g, ' ').trim();
    return { slug, label: label || slug.replace(/-/g, ' ') };
  } catch {
    return null;
  }
}

export function extractStreamCategory(document: CategoryDocument): Category {
  for (const link of document.querySelectorAll('a[data-a-target="stream-game-link"]')) {
    const category = categoryFromLink(link);
    if (category) return category;
  }
  const categories = new Map<string, Category>();
  for (const link of document.querySelectorAll('main a[href*="/directory/category/"]')) {
    const category = categoryFromLink(link);
    if (category) categories.set(category.slug, category);
  }
  return categories.size === 1
    ? (categories.values().next().value ?? { slug: '', label: '' })
    : { slug: '', label: '' };
}
