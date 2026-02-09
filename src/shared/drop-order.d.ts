import type { TwitchDrop } from '../types';

export function comparePendingDrops(a: TwitchDrop, b: TwitchDrop): number;
export function sortPendingDrops(drops: TwitchDrop[]): TwitchDrop[];
export function pickNearestDrop(pendingDrops: TwitchDrop[]): TwitchDrop | null;
