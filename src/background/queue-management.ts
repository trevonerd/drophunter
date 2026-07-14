// Backward-compat re-exports — symbols moved to ./drops-tick (batch 4 of candidate #1).
// External callers should import directly from ./drops-tick; these re-exports are
// temporary scaffold that a later batch will remove once all import sites are updated.
export type {
  CheckDropProgressCallbacks,
  HandleAddToQueueDeps,
  HandleSetSelectedGameCallbacks,
  HandleSetSelectedGameDeps,
  RefreshDropsDataCallbacks,
  RefreshDropsDataDeps,
} from './drops-tick';
export {
  checkDropProgress,
  handleAddToQueue,
  handleRemoveFromQueue,
  handleReorderQueue,
  handleSetSelectedGame,
  refreshDropsData,
} from './drops-tick';
// Backward-compat re-exports — symbols moved to ./queue-operations (batch 1 of candidate #1).
// External callers should import directly from ./queue-operations; these re-exports are
// temporary scaffold that a later batch will remove once all import sites are updated.
export {
  normalizeQueueSelection,
  pushGameToQueue,
  removeGameFromQueue,
  reorderQueue,
  resolveGameFromState,
} from './queue-operations';
// Backward-compat re-exports — symbols moved to ./recovery-state (batch 2 of candidate #1).
// External callers should import directly from ./recovery-state; these re-exports are
// temporary scaffold that a later batch will remove once all import sites are updated.
export {
  applyStopState,
  clearRecoveryState,
  clearStopState,
  enterPersistentRecovery,
} from './recovery-state';
// Backward-compat re-exports — symbols moved to ./session-lifecycle (batch 5 of candidate #1).
// External callers should import directly from ./session-lifecycle; these re-exports are
// temporary scaffold that a later batch will remove once all import sites are updated.
export type { QueueSkipReason } from './session-lifecycle';
export {
  advanceQueueIfCompleted,
  handleStartFarming,
  resetStreamTrackingState,
  skipCurrentGameAndAdvanceQueue,
  skipCurrentGameDueToStall,
  stopFarmingSession,
} from './session-lifecycle';
// Backward-compat re-exports — symbols moved to ./streamer-acquisition (batch 3 of candidate #1).
// External callers should import directly from ./streamer-acquisition; these re-exports are
// temporary scaffold that a later batch will remove once all import sites are updated.
export {
  acquireStreamerForSelectedGame,
  openBestStreamerForSelectedGame,
  rotateStreamer,
  rotateStreamerIfInvalid,
} from './streamer-acquisition';
