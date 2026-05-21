import React from "react";
import { AbsoluteFill, interpolate, spring } from "remotion";
import { useBaseTimeline } from "../timing";

const PERMISSIONS = [
  { label: "storage", detail: "Queue, progress, preferences" },
  { label: "scripting", detail: "Twitch-only playback helpers" },
  { label: "alarms", detail: "MV3 monitoring loop" },
  { label: "notifications", detail: "Optional alerts" },
  { label: "twitch.tv only", detail: "No broad host access" },
];

const NO_ITEMS = ["No cookies permission", "No tabs permission", "No analytics"];

export const TrustScene: React.FC = () => {
  const { frame, fps } = useBaseTimeline();

  const panelIn = spring({ frame, fps, config: { damping: 18, stiffness: 120 } });
  const shieldIn = spring({
    frame: Math.max(0, frame - 24),
    fps,
    config: { damping: 16, stiffness: 140 },
  });
  const glow = (Math.sin(frame * 0.08) + 1) / 2;

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
          inset: 0,
          background:
            "radial-gradient(circle at 22% 30%, rgba(34,197,94,0.14) 0%, transparent 26%), radial-gradient(circle at 78% 66%, rgba(145,70,255,0.16) 0%, transparent 32%)",
        }}
      />

      <div
        style={{
          position: "absolute",
          top: 150,
          left: 180,
          maxWidth: 580,
        }}
      >
        <div
          style={{
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: "#bbf7d0",
          }}
        >
          Local-first by design
        </div>
        <div
          style={{
            marginTop: 12,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: 50,
            fontWeight: 800,
            letterSpacing: -1.4,
            lineHeight: 1.04,
            color: "white",
          }}
        >
          Twitch-only access.
          <br />
          No tracking pipeline.
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
          DropHunter uses your existing Twitch session in the browser and keeps extension data on your machine.
        </div>
      </div>

      <div
        style={{
          opacity: panelIn,
          transform: `translateY(${interpolate(panelIn, [0, 1], [48, 0])}px) scale(${interpolate(panelIn, [0, 1], [0.93, 1])})`,
          width: 520,
          padding: 28,
          borderRadius: 28,
          background: "rgba(18,18,24,0.96)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 28px 70px rgba(0,0,0,0.45)",
          position: "absolute",
          right: 170,
          top: 205,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            marginBottom: 24,
          }}
        >
          <div
            style={{
              width: 58,
              height: 58,
              borderRadius: 18,
              background: "rgba(34,197,94,0.14)",
              border: "1px solid rgba(34,197,94,0.28)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: `0 0 32px rgba(34,197,94,${0.12 + glow * 0.12})`,
              transform: `scale(${interpolate(shieldIn, [0, 1], [0.88, 1])})`,
            }}
          >
            <svg
              width="30"
              height="30"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#bbf7d0"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="M9 12l2 2 4-5" />
            </svg>
          </div>
          <div>
            <div
              style={{
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                fontSize: 16,
                fontWeight: 700,
                letterSpacing: 1.2,
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.45)",
              }}
            >
              Permission profile
            </div>
            <div
              style={{
                marginTop: 4,
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                fontSize: 23,
                fontWeight: 800,
                color: "white",
              }}
            >
              Minimal access for one job.
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {PERMISSIONS.map((permission, index) => {
            const itemIn = spring({
              frame: Math.max(0, frame - 12 - index * 7),
              fps,
              config: { damping: 16, stiffness: 140 },
            });
            return (
              <div
                key={permission.label}
                style={{
                  opacity: itemIn,
                  transform: `translateX(${interpolate(itemIn, [0, 1], [18, 0])}px)`,
                  padding: "12px 14px",
                  borderRadius: 14,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 18,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: "rgba(34,197,94,0.18)",
                      border: "1px solid rgba(34,197,94,0.32)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#bbf7d0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <span
                    style={{
                      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                      fontSize: 16,
                      fontWeight: 800,
                      color: "white",
                    }}
                  >
                    {permission.label}
                  </span>
                </div>
                <span
                  style={{
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                    fontSize: 13,
                    fontWeight: 600,
                    color: "rgba(255,255,255,0.5)",
                    textAlign: "right",
                  }}
                >
                  {permission.detail}
                </span>
              </div>
            );
          })}
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            marginTop: 18,
          }}
        >
          {NO_ITEMS.map((item, index) => {
            const noIn = spring({
              frame: Math.max(0, frame - 52 - index * 6),
              fps,
              config: { damping: 16, stiffness: 140 },
            });
            return (
              <div
                key={item}
                style={{
                  opacity: noIn,
                  transform: `translateY(${interpolate(noIn, [0, 1], [12, 0])}px)`,
                  padding: "9px 12px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.09)",
                  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                  fontSize: 13,
                  fontWeight: 800,
                  color: "rgba(255,255,255,0.72)",
                }}
              >
                {item}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
