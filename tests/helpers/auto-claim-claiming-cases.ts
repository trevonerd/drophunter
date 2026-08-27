import { expect, test } from 'bun:test';
import {
  createSeedDrop,
  createWatchDrop,
  crossGameOne,
  crossGameThree,
  crossGameTwo,
} from '../fixtures/auto-claim-scenarios.ts';
import type { AutoClaimHarness } from './auto-claim-worker.ts';

export function registerAutoClaimClaimingCases(harness: AutoClaimHarness): void {
  test('Toggle OFF → trigger alarm → totalDropsClaimed stays 0', async () => {
    await harness.startFarm();
    const baselineClaims = harness.appState().totalDropsClaimed;
    expect(await harness.dispatch({ type: 'SET_AUTO_CLAIM_DROPS', payload: { enabled: false } })).toEqual({
      success: true,
      autoClaimDrops: false,
    });
    const scenario = [
      createSeedDrop(),
      createWatchDrop(crossGameOne, 'cross-game-one-drop', 'claim-cross-game-one'),
    ];

    await harness.refreshTo(scenario);
    await harness.triggerAlarm(scenario);
    await harness.waitTicks(5);

    expect(harness.appState().totalDropsClaimed).toBe(baselineClaims);
    expect(harness.claimRequests).toHaveLength(0);
  });

  test('Toggle ON → trigger alarm with 1 claimable watch reward → totalDropsClaimed becomes 1', async () => {
    await harness.startFarm();
    const baselineClaims = harness.appState().totalDropsClaimed;
    const claimable = createWatchDrop(crossGameOne, 'claimable-time-drop', 'claim-time-drop');
    const claimed = createWatchDrop(crossGameOne, 'claimable-time-drop', 'claim-time-drop', true);

    await harness.refreshTo([createSeedDrop(), claimable]);
    await harness.triggerAlarm([createSeedDrop(), claimable], [createSeedDrop(), claimed]);

    await harness.waitForState(
      (state) =>
        state.totalDropsClaimed === baselineClaims + 1 && harness.claimRequests.includes('claim-time-drop'),
      'claim did not complete and increment the counter by 1',
    );
    expect(harness.claimRequests).toEqual(['claim-time-drop']);
  });

  test('Toggle ON → trigger alarm with 3 claimable drops from 3 games → totalDropsClaimed becomes 3', async () => {
    await harness.startFarm();
    const baselineClaims = harness.appState().totalDropsClaimed;
    const claimable = [
      createWatchDrop(crossGameOne, 'cross-drop-one', 'claim-cross-one'),
      createWatchDrop(crossGameTwo, 'cross-drop-two', 'claim-cross-two'),
      createWatchDrop(crossGameThree, 'cross-drop-three', 'claim-cross-three'),
    ];
    const claimed = [
      createWatchDrop(crossGameOne, 'cross-drop-one', 'claim-cross-one', true),
      createWatchDrop(crossGameTwo, 'cross-drop-two', 'claim-cross-two', true),
      createWatchDrop(crossGameThree, 'cross-drop-three', 'claim-cross-three', true),
    ];

    await harness.refreshTo([createSeedDrop(), ...claimable]);
    await harness.triggerAlarm([createSeedDrop(), ...claimable], [createSeedDrop(), ...claimed]);

    await harness.waitForState(
      (state) => state.totalDropsClaimed === baselineClaims + 3 && harness.claimRequests.length === 3,
      'claims did not complete and increment the counter by 3',
    );
    expect(harness.claimRequests).toEqual(['claim-cross-one', 'claim-cross-two', 'claim-cross-three']);
  });
}
