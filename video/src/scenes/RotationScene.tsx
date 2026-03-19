import React from "react";
import {
  AbsoluteFill,
  interpolate,
  interpolateColors,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const CARD_W = 300;
const CARD_H = 430;

export const RotationScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const issueProgress = spring({
    frame: Math.max(0, frame - 28),
    fps,
    config: { damping: 18, stiffness: 120 },
  });
  const switchProgress = spring({
    frame: Math.max(0, frame - 68),
    fps,
    config: { damping: 18, stiffness: 130 },
  });
  const currentShift = interpolate(issueProgress, [0, 1], [0, -48], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const nextShift = interpolate(switchProgress, [0, 1], [140, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const nextOpacity = interpolate(switchProgress, [0, 0.45, 1], [0, 0.35, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const warningOpacity = interpolate(issueProgress, [0, 0.45, 1], [0, 0.8, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const arrowOpacity = interpolate(switchProgress, [0, 0.35, 1], [0, 0.4, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const borderColor = interpolateColors(
    issueProgress,
    [0, 1],
    ["rgba(145,70,255,0.4)", "rgba(255,120,120,0.65)"]
  );

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
          Smart stream rotation
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
          Switch streamers only when needed.
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
          DropHunter recovers by finding another eligible stream when progress stalls or the stream goes bad.
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          width: 400,
          height: 400,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(145,70,255,0.1) 0%, transparent 55%)",
          filter: "blur(50px)",
        }}
      />
      <div
        style={{
          display: "flex",
          gap: 44,
          alignItems: "center",
          position: "absolute",
          top: 372,
          left: 560,
        }}
      >
        <div
          style={{
            width: CARD_W,
            height: CARD_H,
            position: "relative",
            borderRadius: 28,
            padding: 24,
            background: "rgba(20,20,24,0.96)",
            border: `2px solid ${borderColor}`,
            boxShadow: "0 22px 55px rgba(0,0,0,0.42)",
            transform: `translateX(${currentShift}px)`,
          }}
        >
          <div
            style={{
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontSize: 16,
              fontWeight: 600,
              color: "rgba(255,255,255,0.55)",
              textTransform: "uppercase",
              letterSpacing: 1.4,
            }}
          >
            Current stream
          </div>
          <div
            style={{
              marginTop: 16,
              height: 166,
              borderRadius: 20,
              background: "linear-gradient(135deg, #9146ff, #5c1cb8)",
              boxShadow: "0 18px 40px rgba(145,70,255,0.28)",
            }}
          />
          <div
            style={{
              marginTop: 18,
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontSize: 24,
              fontWeight: 800,
              color: "white",
            }}
          >
            Stream lost progress
          </div>
          <div
            style={{
              marginTop: 8,
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontSize: 16,
              lineHeight: 1.35,
              color: "rgba(255,255,255,0.62)",
            }}
          >
            Playback paused or the stream is no longer eligible.
          </div>
          <div
            style={{
              position: "absolute",
              left: 24,
              right: 24,
              bottom: 20,
              opacity: warningOpacity,
              padding: "12px 14px",
              borderRadius: 14,
              background: "rgba(88,22,22,0.88)",
              border: "1px solid rgba(255,110,110,0.34)",
              boxShadow: "0 10px 24px rgba(0,0,0,0.28)",
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontSize: 16,
              fontWeight: 700,
              color: "rgba(255,220,220,0.92)",
            }}
          >
            Recovery triggered
          </div>
        </div>
        <div
          style={{
            opacity: arrowOpacity,
            width: 76,
            textAlign: "center",
            transform: `translateX(${interpolate(switchProgress, [0, 1], [0, -24])}px) translateY(${interpolate(
              switchProgress,
              [0, 1],
              [14, 0]
            )}px)`,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: 82,
            fontWeight: 800,
            color: "#a970ff",
            lineHeight: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          →
        </div>
        <div
          style={{
            width: CARD_W,
            height: CARD_H,
            position: "relative",
            borderRadius: 28,
            padding: 24,
            opacity: nextOpacity,
            background: "rgba(20,20,24,0.96)",
            border: "2px solid rgba(145,70,255,0.42)",
            boxShadow: "0 22px 55px rgba(0,0,0,0.42)",
            transform: `translateX(${nextShift}px)`,
          }}
        >
          <div
            style={{
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontSize: 16,
              fontWeight: 600,
              color: "rgba(255,255,255,0.55)",
              textTransform: "uppercase",
              letterSpacing: 1.4,
            }}
          >
            New eligible streamer
          </div>
          <div
            style={{
              marginTop: 16,
              height: 166,
              borderRadius: 20,
              background: "linear-gradient(135deg, #a970ff, #772ce8)",
              boxShadow: "0 18px 40px rgba(145,70,255,0.28)",
            }}
          />
          <div
            style={{
              marginTop: 18,
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontSize: 24,
              fontWeight: 800,
              color: "white",
            }}
          >
            Farming continues
          </div>
          <div
            style={{
              marginTop: 8,
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontSize: 16,
              lineHeight: 1.35,
              color: "rgba(255,255,255,0.62)",
            }}
          >
            DropHunter opens the next valid streamer so your watch time keeps moving.
          </div>
          <div
            style={{
              position: "absolute",
              left: 24,
              right: 24,
              bottom: 20,
              padding: "12px 14px",
              borderRadius: 14,
              background: "rgba(54,26,102,0.9)",
              border: "1px solid rgba(145,70,255,0.34)",
              boxShadow: "0 10px 24px rgba(0,0,0,0.28)",
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontSize: 16,
              fontWeight: 700,
              color: "rgba(255,255,255,0.88)",
            }}
          >
            Next best stream found
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
