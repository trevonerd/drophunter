import './cases/messages-01.ts';
import './cases/messages-02.ts';
import { expect, test } from 'bun:test';
import { isTwitchGameLike } from '../src/shared/message-validation.ts';

test.each([Number.NaN, Infinity, -Infinity, -1, 0.5])('rejects invalid drop count %s', (dropCount) => {
  expect(isTwitchGameLike({ id: 'game', name: 'Game', imageUrl: '', dropCount })).toBe(false);
});
