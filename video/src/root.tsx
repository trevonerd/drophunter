import React from "react";
import { Audio, Composition, interpolate, staticFile } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { IntroScene } from "./scenes/IntroScene";
import { ControlScene } from "./scenes/ControlScene";
import { QueueScene } from "./scenes/QueueScene";
import { MonitorScene } from "./scenes/MonitorScene";
import { RotationScene } from "./scenes/RotationScene";
import { ClaimScene } from "./scenes/ClaimScene";
import { RecoveryScene } from "./scenes/RecoveryScene";
import { CtaScene } from "./scenes/CtaScene";

const FPS = 30;
const TRANSITION = 12;
const MUSIC_VOLUME = 0.32;
const MUSIC_FADE_OUT_FRAMES = FPS * 2;
const TOTAL =
  96 + 126 + 150 + 180 + 150 + 150 + 150 + 144 - 7 * TRANSITION;

const FullPromo: React.FC = () => (
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
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={96}>
        <IntroScene />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION })}
      />
      <TransitionSeries.Sequence durationInFrames={126}>
        <ControlScene />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION })}
      />
      <TransitionSeries.Sequence durationInFrames={150}>
        <QueueScene />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION })}
      />
      <TransitionSeries.Sequence durationInFrames={180}>
        <MonitorScene />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION })}
      />
      <TransitionSeries.Sequence durationInFrames={150}>
        <RotationScene />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION })}
      />
      <TransitionSeries.Sequence durationInFrames={150}>
        <ClaimScene />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION })}
      />
      <TransitionSeries.Sequence durationInFrames={150}>
        <RecoveryScene />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION })}
      />
      <TransitionSeries.Sequence durationInFrames={144}>
        <CtaScene />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  </>
);

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Promo"
      component={FullPromo}
      durationInFrames={TOTAL}
      fps={FPS}
      width={1920}
      height={1080}
    />
    <Composition
      id="Cta"
      component={CtaScene}
      durationInFrames={120}
      fps={FPS}
      width={1920}
      height={1080}
    />
  </>
);
