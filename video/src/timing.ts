import { useCurrentFrame } from "remotion";

export const OUTPUT_FPS = 60;
export const AUTHORING_FPS = 30;
export const DESIGN_WIDTH = 1920;
export const DESIGN_HEIGHT = 1080;
export const HD_WIDTH = 1920;
export const HD_HEIGHT = 1080;
export const FOUR_K_WIDTH = 3840;
export const FOUR_K_HEIGHT = 2160;

export const secondsToFrames = (seconds: number): number => Math.round(seconds * OUTPUT_FPS);
export const baseFramesToOutputFrames = (frames: number): number =>
  Math.round((frames / AUTHORING_FPS) * OUTPUT_FPS);

export function useBaseTimeline() {
  return {
    frame: useCurrentFrame() * (AUTHORING_FPS / OUTPUT_FPS),
    fps: AUTHORING_FPS,
  };
}
