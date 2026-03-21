import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const RecoveryScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const bellIn = spring({ frame, fps, config: { damping: 16, stiffness: 130 } });
  const pulse = (Math.sin(frame * 0.15) + 1) / 2;
  const ringScale = interpolate(pulse, [0, 1], [1, 1.15]);

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
            color: "#ffb450",
          }}
        >
          Playback recovery alerts
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
          If Twitch flakes out,
          <br />
          DropHunter pushes back.
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
          It tries to recover playback first, then tells you clearly when Twitch still needs a manual click.
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          width: 400,
          height: 400,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,180,80,0.08) 0%, transparent 55%)",
          filter: "blur(50px)",
        }}
      />
      <div
        style={{
          transform: `scale(${bellIn})`,
          width: 120,
          height: 120,
          borderRadius: 24,
          background: "rgba(255,180,80,0.15)",
          border: "2px solid rgba(255,180,80,0.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: `0 0 40px rgba(255,180,80,${0.2 + pulse * 0.15})`,
        }}
      >
        <div
          style={{
            transform: `scale(${ringScale})`,
            width: 60,
            height: 60,
            borderRadius: "50%",
            border: "3px solid rgba(255,180,80,0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span
            style={{
              fontSize: 32,
              fontWeight: 800,
              color: "rgba(255,180,80,0.95)",
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            }}
          >
            !
          </span>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 170,
          padding: "14px 22px",
          borderRadius: 16,
          background: "rgba(255,180,80,0.14)",
          border: "1px solid rgba(255,180,80,0.28)",
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          fontSize: 20,
          fontWeight: 600,
          color: "rgba(255,240,214,0.95)",
        }}
        >
          Playback still needs a quick manual check.
        </div>
    </AbsoluteFill>
  );
};
