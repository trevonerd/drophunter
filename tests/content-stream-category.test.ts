import { expect, test } from 'bun:test';
import { extractStreamCategory } from '../src/content/stream-category.ts';

const link = (slug: string, textContent: string) => ({
  textContent,
  getAttribute: () => `/directory/category/${slug}`,
});

test('primary watched category outranks earlier sidebar and recommendation links', () => {
  const sidebar = link('just-chatting', 'Just Chatting');
  const watched = link('overwatch', 'Overwatch');
  const result = extractStreamCategory({
    querySelectorAll: (selector) =>
      selector === 'a[data-a-target="stream-game-link"]' ? [watched] : [sidebar, watched],
  });
  expect(result).toEqual({ slug: 'overwatch', label: 'Overwatch' });
});

test('a missing primary category uses only an unambiguous main-content fallback', () => {
  const watched = link('overwatch', 'Overwatch');
  expect(
    extractStreamCategory({
      querySelectorAll: (selector) => (selector.startsWith('main ') ? [watched, watched] : []),
    }),
  ).toEqual({ slug: 'overwatch', label: 'Overwatch' });
  expect(
    extractStreamCategory({
      querySelectorAll: (selector) =>
        selector.startsWith('main ') ? [watched, link('just-chatting', 'Just Chatting')] : [],
    }),
  ).toEqual({ slug: '', label: '' });
});

test('sidebar-only data does not invent a watched category', () => {
  expect(
    extractStreamCategory({
      querySelectorAll: (selector) =>
        selector.startsWith('main ') || selector.includes('stream-game-link')
          ? []
          : [link('just-chatting', 'Just Chatting')],
    }),
  ).toEqual({ slug: '', label: '' });
});

test('category URL parsing ignores query and fragment while rejecting malformed links', () => {
  const watched = {
    textContent: 'Overwatch',
    getAttribute: () => 'https://www.twitch.tv/directory/category/overwatch-2?sort=recent#live',
  };
  expect(extractStreamCategory({ querySelectorAll: () => [watched] })).toEqual({
    slug: 'overwatch-2',
    label: 'Overwatch',
  });
  expect(
    extractStreamCategory({
      querySelectorAll: () => [{ textContent: 'Invalid', getAttribute: () => 'http://[' }],
    }),
  ).toEqual({ slug: '', label: '' });
});
