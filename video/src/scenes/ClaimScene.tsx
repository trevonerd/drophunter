import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const ClaimScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const boxScale = spring({ frame, fps, config: { damping: 16, stiffness: 120 } });
  const checkProgress = spring({
    frame: Math.max(0, frame - 35),
    fps,
    config: { damping: 18, stiffness: 180 },
  });
  const rewardPop = spring({
    frame: Math.max(0, frame - 55),
    fps,
    config: { damping: 12, stiffness: 140 },
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#0e0e10",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 150,
          left: 180,
          maxWidth: 560,
        }}
      >
        <div
          style={{
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: "#a970ff",
          }}
        >
          Auto-claim rewards
        </div>
        <div
          style={{
            marginTop: 12,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: 48,
            fontWeight: 800,
            letterSpacing: -1.2,
            lineHeight: 1.05,
            color: "white",
          }}
        >
          Claim drops the moment Twitch unlocks them.
        </div>
        <div
          style={{
            marginTop: 14,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: 22,
            lineHeight: 1.4,
            color: "rgba(255,255,255,0.68)",
          }}
        >
          No refreshing the inventory page. No manual clicking every few minutes.
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          width: 500,
          height: 500,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(145,70,255,0.12) 0%, transparent 55%)",
          filter: "blur(50px)",
        }}
      />
      <div
        style={{
          transform: `scale(${boxScale})`,
          width: 180,
          height: 180,
          borderRadius: 24,
          background: "rgba(255,255,255,0.06)",
          border: "2px solid rgba(145,70,255,0.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        <svg
          width="80"
          height="80"
          viewBox="0 0 24 24"
          fill="none"
          stroke="url(#g)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            opacity: checkProgress,
            transform: `scale(${interpolate(checkProgress, [0, 1], [0.5, 1])})`,
          }}
        >
          <defs>
            <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#a970ff" />
              <stop offset="100%" stopColor="#772ce8" />
            </linearGradient>
          </defs>
          <path d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 180,
          opacity: rewardPop,
          transform: `translateY(${interpolate(rewardPop, [0, 1], [20, 0])}px) scale(${rewardPop})`,
          padding: "12px 24px",
          borderRadius: 999,
          background: "linear-gradient(135deg, #9146ff, #772ce8)",
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          fontSize: 20,
          fontWeight: 700,
          color: "white",
        }}
      >
        Claimed
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 130,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          fontSize: 20,
          color: "rgba(255,255,255,0.55)",
        }}
      >
        Reward secured automatically.
      </div>
    </AbsoluteFill>
  );
};
