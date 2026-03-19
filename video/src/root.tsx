import React from "react";
import { Composition } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { IntroScene } from "./scenes/IntroScene";
import { QueueScene } from "./scenes/QueueScene";
import { MonitorScene } from "./scenes/MonitorScene";
import { RotationScene } from "./scenes/RotationScene";
import { ClaimScene } from "./scenes/ClaimScene";
import { RecoveryScene } from "./scenes/RecoveryScene";
import { CtaScene } from "./scenes/CtaScene";

const FPS = 30;
const TRANSITION = 12;

const FullPromo: React.FC = () => (
  <TransitionSeries>
    <TransitionSeries.Sequence durationInFrames={90}>
      <IntroScene />
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
    <TransitionSeries.Sequence durationInFrames={120}>
      <CtaScene />
    </TransitionSeries.Sequence>
  </TransitionSeries>
);

const TOTAL =
  90 + 150 + 180 + 150 + 150 + 150 + 120 - 6 * TRANSITION;

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
