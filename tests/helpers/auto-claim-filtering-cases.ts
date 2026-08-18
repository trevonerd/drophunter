import { expect, test } from 'bun:test';
import {
  createSeedDrop,
  createWatchDrop,
  crossGameOne,
  type SnapshotDropSpec,
} from '../fixtures/auto-claim-scenarios.ts';
import type { AutoClaimHarness } from './auto-claim-worker.ts';

export function registerAutoClaimFilteringCases(harness: AutoClaimHarness): void {
  async function expectScenarioSkipped(scenario: readonly SnapshotDropSpec[]): Promise<void> {
    await harness.startFarm();
    const baselineClaims = harness.appState().totalDropsClaimed;
    await harness.refreshTo(scenario);
    await harness.triggerAlarm(scenario);
    await harness.waitTicks(5);
    expect(harness.appState().totalDropsClaimed).toBe(baselineClaims);
    expect(harness.claimRequests).toHaveLength(0);
  }

  test('Toggle ON → trigger alarm with 1 subscription-gated claimable reward → totalDropsClaimed stays 0', async () => {
    await expectScenarioSkipped([
      createSeedDrop(),
      {
        game: crossGameOne,
        dropId: 'subscription-reward',
        claimId: 'claim-subscription-reward',
        currentMinutes: 0,
        requiredMinutes: 0,
        claimed: false,
        claimable: true,
      },
    ]);
  });

  test('Toggle ON → trigger alarm with 1 already-claimed drop → totalDropsClaimed stays 0', async () => {
    await expectScenarioSkipped([
      createSeedDrop(),
      createWatchDrop(crossGameOne, 'already-claimed-drop', 'claim-already-claimed', true),
    ]);
  });

  test('Toggle ON → trigger alarm with empty snapshot → no errors and totalDropsClaimed stays 0', async () => {
    await harness.startFarm();
    const baselineClaims = harness.appState().totalDropsClaimed;
    await harness.refreshTo([]);
    await harness.triggerAlarm([]);
    await harness.waitTicks(5);

    const state = harness.appState();
    expect(state.isRunning).toBe(true);
    expect(state.totalDropsClaimed).toBe(baselineClaims);
    expect(harness.claimRequests).toHaveLength(0);
  });
}
