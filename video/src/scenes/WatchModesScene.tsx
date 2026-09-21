import React from "react";
import { AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export const WatchModesScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fallbackActive = frame >= 2.55 * fps;
  const manualActive = frame >= 3.7 * fps;

  return (
    <AbsoluteFill style={{ backgroundColor: "#0e0e10", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 20% 68%, rgba(34,197,94,0.15) 0%, transparent 30%), radial-gradient(circle at 80% 28%, rgba(125,211,252,0.17) 0%, transparent 32%)",
        }}
      />

      <Interactive.Div
        name="Watch modes copy"
        style={{
          position: "absolute",
          top: 175,
          left: 180,
          width: 670,
          opacity: interpolate(frame, [0, 0.8 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(frame, [0, 0.8 * fps], ["-36px 0px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <div style={{ fontFamily: "system-ui", fontSize: 22, fontWeight: 800, letterSpacing: 3, textTransform: "uppercase", color: "#7dd3fc" }}>
          Flexible watch transport
        </div>
        <div style={{ marginTop: 20, fontFamily: "system-ui", fontSize: 84, fontWeight: 850, letterSpacing: -3.2, lineHeight: 0.98, color: "white" }}>
          Farm without babysitting a tab.
        </div>
        <div style={{ marginTop: 26, maxWidth: 610, fontFamily: "system-ui", fontSize: 30, lineHeight: 1.35, color: "rgba(255,255,255,0.7)" }}>
          Start hidden. Fall back to a muted managed tab when Twitch needs it. Your own Twitch viewing always comes first.
        </div>
      </Interactive.Div>

      <Interactive.Div
        name="Watch transport card"
        style={{
          position: "absolute",
          top: 150,
          right: 150,
          width: 650,
          padding: 32,
          borderRadius: 30,
          backgroundColor: "rgba(20,20,26,0.96)",
          border: "1px solid rgba(255,255,255,0.10)",
          boxShadow: "0 34px 90px rgba(0,0,0,0.5)",
          opacity: interpolate(frame, [0.25 * fps, 1.1 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(frame, [0.25 * fps, 1.1 * fps], ["50px 0px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontFamily: "system-ui", fontSize: 20, fontWeight: 800, color: "white" }}>Watch source</div>
          <div style={{ padding: "9px 15px", borderRadius: 999, backgroundColor: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.25)", fontFamily: "system-ui", fontSize: 15, fontWeight: 800, color: "#bbf7d0" }}>
            Automatic
          </div>
        </div>

        <div style={{ position: "relative", height: 310, marginTop: 24 }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              padding: 26,
              borderRadius: 24,
              backgroundColor: "rgba(34,197,94,0.10)",
              border: "1px solid rgba(34,197,94,0.26)",
              opacity: interpolate(frame, [2.25 * fps, 2.8 * fps], [1, 0], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
              translate: interpolate(frame, [2.25 * fps, 2.8 * fps], ["0px 0px", "-30px 0px"], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
            }}
          >
            <div style={{ fontSize: 54 }}>◉</div>
            <div style={{ marginTop: 22, fontFamily: "system-ui", fontSize: 28, fontWeight: 850, color: "white" }}>No stream tab</div>
            <div style={{ marginTop: 10, fontFamily: "system-ui", fontSize: 19, lineHeight: 1.4, color: "rgba(255,255,255,0.58)" }}>Hidden farming keeps the browser tidy while progress moves.</div>
            <div style={{ display: "flex", gap: 8, marginTop: 28 }}>
              {[0, 1, 2, 3].map((bar) => (
                <div key={bar} style={{ width: 96, height: 8, borderRadius: 999, backgroundColor: bar < 3 ? "#22c55e" : "rgba(255,255,255,0.12)" }} />
              ))}
            </div>
          </div>

          <div
            style={{
              position: "absolute",
              inset: 0,
              padding: 26,
              borderRadius: 24,
              backgroundColor: "rgba(125,211,252,0.09)",
              border: "1px solid rgba(125,211,252,0.28)",
              opacity: interpolate(frame, [2.35 * fps, 3 * fps], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
              translate: interpolate(frame, [2.35 * fps, 3 * fps], ["30px 0px", "0px 0px"], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 54 }}>▣</div>
              <div style={{ padding: "8px 13px", borderRadius: 999, backgroundColor: "rgba(125,211,252,0.13)", fontFamily: "system-ui", fontSize: 14, fontWeight: 800, color: "#bae6fd" }}>Muted</div>
            </div>
            <div style={{ marginTop: 18, fontFamily: "system-ui", fontSize: 28, fontWeight: 850, color: "white" }}>Managed fallback</div>
            <div style={{ marginTop: 10, fontFamily: "system-ui", fontSize: 19, lineHeight: 1.4, color: "rgba(255,255,255,0.58)" }}>A prepared tab takes over only after playback is viable.</div>
            <div style={{ marginTop: 24, height: 9, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.10)", overflow: "hidden" }}>
              <div style={{ width: fallbackActive ? "82%" : "0%", height: "100%", borderRadius: 999, background: "linear-gradient(90deg, #7dd3fc, #a970ff)" }} />
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            marginTop: 20,
            padding: "16px 18px",
            borderRadius: 18,
            backgroundColor: "rgba(250,204,21,0.10)",
            border: "1px solid rgba(250,204,21,0.23)",
            opacity: interpolate(frame, [3.55 * fps, 4.25 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          <div style={{ fontSize: 28 }}>{manualActive ? "⏸" : "▶"}</div>
          <div>
            <div style={{ fontFamily: "system-ui", fontSize: 18, fontWeight: 800, color: "#fde68a" }}>Your Twitch stream has priority</div>
            <div style={{ marginTop: 3, fontFamily: "system-ui", fontSize: 14, color: "rgba(255,255,255,0.56)" }}>Automation pauses and resumes after you finish.</div>
          </div>
        </div>
      </Interactive.Div>
    </AbsoluteFill>
  );
};
