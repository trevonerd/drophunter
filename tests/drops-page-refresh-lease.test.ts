import { expect, test } from 'bun:test';
import { createDropsPageState, createTabsApi, createTestRefresher } from './fixtures/drops-page-refresh.ts';

test('manual recovery replaces a cancelled hidden refresh and late cleanup cannot release the new lease', async () => {
  const firstLoad = Promise.withResolvers<void>();
  const secondLoad = Promise.withResolvers<void>();
  const enteredFirst = Promise.withResolvers<void>();
  const enteredSecond = Promise.withResolvers<void>();
  let current = true;
  let loads = 0;
  const tabs = createTabsApi();
  tabs.setQueryResult([{ id: 42 }]);
  const refresher = createTestRefresher(createDropsPageState(), tabs, {
    campaignRefreshAttempts: 1,
    waitForTabComplete: () => {
      loads += 1;
      if (loads === 1) {
        enteredFirst.resolve();
        return firstLoad.promise;
      }
      enteredSecond.resolve();
      return secondLoad.promise;
    },
  });
  const hidden = refresher.openDropsPageAndRefresh({ active: false, isCurrent: () => current });
  await enteredFirst.promise;
  current = false;
  const manual = refresher.openDropsPageAndRefresh({ active: true });
  expect(manual).not.toBe(hidden);
  await enteredSecond.promise;
  firstLoad.resolve();
  await hidden;
  expect(refresher.openDropsPageAndRefresh()).toBe(manual);
  secondLoad.resolve();
  await manual;
  expect(tabs.activated).toEqual([42]);
  expect(loads).toBe(2);
});

test('the next browser event replaces a refresh whose wall-clock lease expired during sleep', async () => {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    const entered = Promise.withResolvers<void>();
    const load = Promise.withResolvers<void>();
    let loads = 0;
    const refresher = createTestRefresher(createDropsPageState(), createTabsApi(), {
      campaignRefreshAttempts: 1,
      waitForTabComplete: () => {
        loads += 1;
        entered.resolve();
        return loads === 1 ? load.promise : Promise.resolve();
      },
    });
    const stale = refresher.openDropsPageAndRefresh({ active: false });
    await entered.promise;
    now += 72 * 60 * 60_000;
    const fresh = refresher.openDropsPageAndRefresh();
    expect(fresh).not.toBe(stale);
    await fresh;
    load.resolve();
    await stale;
    expect(loads).toBe(2);
  } finally {
    Date.now = originalNow;
  }
});
