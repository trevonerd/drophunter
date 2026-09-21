import React from "react";
import { AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export const AlertsScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: "#0e0e10", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 24% 30%, rgba(145,70,255,0.21) 0%, transparent 30%), radial-gradient(circle at 80% 70%, rgba(56,189,248,0.14) 0%, transparent 33%)",
        }}
      />

      <Interactive.Div
        name="Alerts copy"
        style={{
          position: "absolute",
          top: 170,
          left: 180,
          width: 650,
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
        <div style={{ fontFamily: "system-ui", fontSize: 22, fontWeight: 800, letterSpacing: 3, textTransform: "uppercase", color: "#c4b5fd" }}>
          Alerts and history
        </div>
        <div style={{ marginTop: 20, fontFamily: "system-ui", fontSize: 82, fontWeight: 850, letterSpacing: -3, lineHeight: 0.98, color: "white" }}>
          Know what happened. Wherever you are.
        </div>
        <div style={{ marginTop: 26, maxWidth: 610, fontFamily: "system-ui", fontSize: 30, lineHeight: 1.35, color: "rgba(255,255,255,0.7)" }}>
          Optional desktop and Telegram alerts stay independent. Every claimed reward remains in your local history.
        </div>
      </Interactive.Div>

      <Interactive.Div
        name="Alerts dashboard"
        style={{
          position: "absolute",
          top: 135,
          right: 145,
          width: 670,
          height: 810,
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
        <div
          style={{
            padding: 26,
            borderRadius: 28,
            backgroundColor: "rgba(20,20,26,0.96)",
            border: "1px solid rgba(255,255,255,0.10)",
            boxShadow: "0 34px 90px rgba(0,0,0,0.5)",
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div style={{ padding: 20, borderRadius: 20, backgroundColor: "rgba(145,70,255,0.13)", border: "1px solid rgba(145,70,255,0.26)" }}>
              <div style={{ fontFamily: "system-ui", fontSize: 14, fontWeight: 800, letterSpacing: 1.5, textTransform: "uppercase", color: "rgba(255,255,255,0.46)" }}>Drops claimed</div>
              <div style={{ marginTop: 8, fontFamily: "system-ui", fontSize: 46, fontWeight: 900, color: "white" }}>128</div>
            </div>
            <div style={{ padding: 20, borderRadius: 20, backgroundColor: "rgba(56,189,248,0.10)", border: "1px solid rgba(56,189,248,0.23)" }}>
              <div style={{ fontFamily: "system-ui", fontSize: 14, fontWeight: 800, letterSpacing: 1.5, textTransform: "uppercase", color: "rgba(255,255,255,0.46)" }}>Point bonuses</div>
              <div style={{ marginTop: 8, fontFamily: "system-ui", fontSize: 46, fontWeight: 900, color: "white" }}>342</div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 24 }}>
            <div style={{ fontFamily: "system-ui", fontSize: 19, fontWeight: 850, color: "white" }}>Recent claims</div>
            <div style={{ fontFamily: "system-ui", fontSize: 14, fontWeight: 700, color: "#c4b5fd" }}>Stored locally</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 11, marginTop: 16 }}>
            {["Neon Strike Skin", "Champion Emote", "Rival Player Card"].map((reward, index) => (
              <div
                key={reward}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "14px 16px",
                  borderRadius: 16,
                  backgroundColor: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  opacity: interpolate(frame, [(0.7 + index * 0.2) * fps, (1.3 + index * 0.2) * fps], [0, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                    easing: Easing.bezier(0.16, 1, 0.3, 1),
                  }),
                  translate: interpolate(frame, [(0.7 + index * 0.2) * fps, (1.3 + index * 0.2) * fps], ["0px 16px", "0px 0px"], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                    easing: Easing.bezier(0.16, 1, 0.3, 1),
                  }),
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #9146ff, #5c1cb8)", fontSize: 18 }}>✓</div>
                  <div>
                    <div style={{ fontFamily: "system-ui", fontSize: 16, fontWeight: 800, color: "white" }}>{reward}</div>
                    <div style={{ marginTop: 2, fontFamily: "system-ui", fontSize: 13, color: "rgba(255,255,255,0.46)" }}>Marvel Rivals</div>
                  </div>
                </div>
                <div style={{ fontFamily: "system-ui", fontSize: 13, fontWeight: 800, color: "#86efac" }}>Claimed</div>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            left: -28,
            right: 32,
            bottom: -6,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "18px 20px",
              borderRadius: 20,
              backgroundColor: "rgba(32,32,40,0.98)",
              border: "1px solid rgba(255,255,255,0.11)",
              boxShadow: "0 18px 50px rgba(0,0,0,0.46)",
              opacity: interpolate(frame, [2.4 * fps, 3.05 * fps], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
              translate: interpolate(frame, [2.4 * fps, 3.05 * fps], ["0px 22px", "0px 0px"], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
            }}
          >
            <div style={{ width: 48, height: 48, borderRadius: 15, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(145,70,255,0.18)", fontSize: 24 }}>🔔</div>
            <div>
              <div style={{ fontFamily: "system-ui", fontSize: 17, fontWeight: 850, color: "white" }}>Desktop · Drop claimed</div>
              <div style={{ marginTop: 3, fontFamily: "system-ui", fontSize: 14, color: "rgba(255,255,255,0.56)" }}>Neon Strike Skin is now yours.</div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              marginLeft: 70,
              padding: "18px 20px",
              borderRadius: 20,
              backgroundColor: "rgba(19,47,65,0.98)",
              border: "1px solid rgba(56,189,248,0.24)",
              boxShadow: "0 18px 50px rgba(0,0,0,0.46)",
              opacity: interpolate(frame, [3.2 * fps, 3.85 * fps], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
              translate: interpolate(frame, [3.2 * fps, 3.85 * fps], ["0px 22px", "0px 0px"], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
            }}
          >
            <div style={{ width: 48, height: 48, borderRadius: 15, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(56,189,248,0.15)", fontSize: 25 }}>➤</div>
            <div>
              <div style={{ fontFamily: "system-ui", fontSize: 17, fontWeight: 850, color: "white" }}>Telegram · Campaign complete</div>
              <div style={{ marginTop: 3, fontFamily: "system-ui", fontSize: 14, color: "rgba(255,255,255,0.58)" }}>Next favorite queued automatically.</div>
            </div>
          </div>
        </div>
      </Interactive.Div>
    </AbsoluteFill>
  );
};
