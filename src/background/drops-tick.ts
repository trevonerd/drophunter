// Stable public surface for drop monitoring, refresh, selection, and queue handlers.

/** @public Stable facade callback contract. */
export type { CheckDropProgressCallbacks } from './drops-tick-monitoring.ts';
export { checkDropProgress } from './drops-tick-monitoring.ts';
/** @public Stable facade dependency contract. */
export type { HandleAddToQueueDeps } from './drops-tick-queue.ts';
export {
  handleAddToQueue,
  handleRemoveFromQueue,
  handleReorderQueue,
} from './drops-tick-queue.ts';
/** @public Stable facade refresh contract. */
export type { RefreshDropsDataCallbacks, RefreshDropsDataDeps } from './drops-tick-refresh.ts';
export { refreshDropsData } from './drops-tick-refresh.ts';
/** @public Stable facade selection contract. */
export type {
  HandleSetSelectedGameCallbacks,
  HandleSetSelectedGameDeps,
} from './drops-tick-selection.ts';
export { handleSetSelectedGame } from './drops-tick-selection.ts';
