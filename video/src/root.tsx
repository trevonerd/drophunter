import React from "react";
import { AbsoluteFill, Audio, Composition, interpolate, staticFile } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { IntroScene } from "./scenes/IntroScene";
import { ControlScene } from "./scenes/ControlScene";
import { RefreshScene } from "./scenes/RefreshScene";
import { QueueScene } from "./scenes/QueueScene";
import { MonitorScene } from "./scenes/MonitorScene";
import { RotationScene } from "./scenes/RotationScene";
import { ClaimScene } from "./scenes/ClaimScene";
import { SettingsScene } from "./scenes/SettingsScene";
import { ChannelPointsScene } from "./scenes/ChannelPointsScene";
import { RecoveryScene } from "./scenes/RecoveryScene";
import { TrustScene } from "./scenes/TrustScene";
import { CtaScene } from "./scenes/CtaScene";
import {
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  FOUR_K_HEIGHT,
  FOUR_K_WIDTH,
  HD_HEIGHT,
  HD_WIDTH,
  OUTPUT_FPS,
  baseFramesToOutputFrames,
  secondsToFrames,
} from "./timing";

const TRANSITION = baseFramesToOutputFrames(12);
const MUSIC_VOLUME = 0.32;
const MUSIC_FADE_OUT_FRAMES = secondsToFrames(2);

const SCENES = {
  intro: baseFramesToOutputFrames(96),
  refresh: baseFramesToOutputFrames(132),
  control: baseFramesToOutputFrames(126),
  settings: baseFramesToOutputFrames(150),
  queue: baseFramesToOutputFrames(150),
  monitor: baseFramesToOutputFrames(180),
  rotation: baseFramesToOutputFrames(150),
  claim: baseFramesToOutputFrames(150),
  channelPoints: baseFramesToOutputFrames(150),
  recovery: baseFramesToOutputFrames(150),
  trust: baseFramesToOutputFrames(150),
  cta: baseFramesToOutputFrames(144),
};

const TOTAL =
  Object.values(SCENES).reduce((sum, duration) => sum + duration, 0) - 11 * TRANSITION;

const ScaleToOutput: React.FC<{ children: React.ReactNode; scale: number }> = ({
  children,
  scale,
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#0e0e10", overflow: "hidden" }}>
      <div
        style={{
          position: "relative",
          width: DESIGN_WIDTH,
          height: DESIGN_HEIGHT,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};

const PromoTimeline: React.FC = () => (
  <TransitionSeries>
    <TransitionSeries.Sequence durationInFrames={SCENES.intro}>
      <IntroScene />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition
      presentation={fade()}
      timing={linearTiming({ durationInFrames: TRANSITION })}
    />
    <TransitionSeries.Sequence durationInFrames={SCENES.refresh}>
      <RefreshScene />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition
      presentation={fade()}
      timing={linearTiming({ durationInFrames: TRANSITION })}
    />
    <TransitionSeries.Sequence durationInFrames={SCENES.control}>
      <ControlScene />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition
      presentation={fade()}
      timing={linearTiming({ durationInFrames: TRANSITION })}
    />
    <TransitionSeries.Sequence durationInFrames={SCENES.settings}>
      <SettingsScene />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition
      presentation={fade()}
      timing={linearTiming({ durationInFrames: TRANSITION })}
    />
    <TransitionSeries.Sequence durationInFrames={SCENES.queue}>
      <QueueScene />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition
      presentation={fade()}
      timing={linearTiming({ durationInFrames: TRANSITION })}
    />
    <TransitionSeries.Sequence durationInFrames={SCENES.monitor}>
      <MonitorScene />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition
      presentation={fade()}
      timing={linearTiming({ durationInFrames: TRANSITION })}
    />
    <TransitionSeries.Sequence durationInFrames={SCENES.rotation}>
      <RotationScene />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition
      presentation={fade()}
      timing={linearTiming({ durationInFrames: TRANSITION })}
    />
    <TransitionSeries.Sequence durationInFrames={SCENES.claim}>
      <ClaimScene />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition
      presentation={fade()}
      timing={linearTiming({ durationInFrames: TRANSITION })}
    />
    <TransitionSeries.Sequence durationInFrames={SCENES.channelPoints}>
      <ChannelPointsScene />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition
      presentation={fade()}
      timing={linearTiming({ durationInFrames: TRANSITION })}
    />
    <TransitionSeries.Sequence durationInFrames={SCENES.recovery}>
      <RecoveryScene />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition
      presentation={fade()}
      timing={linearTiming({ durationInFrames: TRANSITION })}
    />
    <TransitionSeries.Sequence durationInFrames={SCENES.trust}>
      <TrustScene />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition
      presentation={fade()}
      timing={linearTiming({ durationInFrames: TRANSITION })}
    />
    <TransitionSeries.Sequence durationInFrames={SCENES.cta}>
      <CtaScene />
    </TransitionSeries.Sequence>
  </TransitionSeries>
);

const FullPromo: React.FC<{ scale: number }> = ({ scale }) => (
  <>
    <Audio
      src={staticFile("audio/DropHunter.mp3")}
      volume={(frame) =>
        interpolate(
          frame,
          [0, TOTAL - MUSIC_FADE_OUT_FRAMES, TOTAL],
          [MUSIC_VOLUME, MUSIC_VOLUME, 0],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          },
        )
      }
    />
    <ScaleToOutput scale={scale}>
      <PromoTimeline />
    </ScaleToOutput>
  </>
);

const Promo1080p60: React.FC = () => <FullPromo scale={HD_WIDTH / DESIGN_WIDTH} />;
const Promo4K60: React.FC = () => <FullPromo scale={FOUR_K_WIDTH / DESIGN_WIDTH} />;

const CtaScaled: React.FC<{ scale: number }> = ({ scale }) => (
  <ScaleToOutput scale={scale}>
    <CtaScene />
  </ScaleToOutput>
);

const Cta1080p60: React.FC = () => <CtaScaled scale={HD_WIDTH / DESIGN_WIDTH} />;
const Cta4K60: React.FC = () => <CtaScaled scale={FOUR_K_WIDTH / DESIGN_WIDTH} />;

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Promo1080p60"
      component={Promo1080p60}
      durationInFrames={TOTAL}
      fps={OUTPUT_FPS}
      width={HD_WIDTH}
      height={HD_HEIGHT}
    />
    <Composition
      id="Promo4K60"
      component={Promo4K60}
      durationInFrames={TOTAL}
      fps={OUTPUT_FPS}
      width={FOUR_K_WIDTH}
      height={FOUR_K_HEIGHT}
    />
    <Composition
      id="Cta1080p60"
      component={Cta1080p60}
      durationInFrames={secondsToFrames(4)}
      fps={OUTPUT_FPS}
      width={HD_WIDTH}
      height={HD_HEIGHT}
    />
    <Composition
      id="Cta4K60"
      component={Cta4K60}
      durationInFrames={secondsToFrames(4)}
      fps={OUTPUT_FPS}
      width={FOUR_K_WIDTH}
      height={FOUR_K_HEIGHT}
    />
  </>
);
