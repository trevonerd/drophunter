import React from "react";
import { AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

const campaigns = [
  { name: "Marvel Rivals", detail: "Ends in 6h", favorite: true },
  { name: "Path of Exile 2", detail: "Ends in 2d", favorite: false },
  { name: "FragPunk", detail: "Ends in 4d", favorite: false },
];

export const FavoritesScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: "#0e0e10", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 22% 32%, rgba(250,204,21,0.13) 0%, transparent 30%), radial-gradient(circle at 78% 66%, rgba(145,70,255,0.22) 0%, transparent 34%)",
        }}
      />

      <Interactive.Div
        name="Favorites copy"
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
        <div
          style={{
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: 3,
            textTransform: "uppercase",
            color: "#fde68a",
          }}
        >
          Favorite auto-start
        </div>
        <div
          style={{
            marginTop: 20,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontSize: 82,
            fontWeight: 850,
            letterSpacing: -3,
            lineHeight: 0.98,
            color: "white",
          }}
        >
          Star a game.
          <br />
          DropHunter takes it from there.
        </div>
        <div
          style={{
            marginTop: 26,
            maxWidth: 600,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontSize: 30,
            lineHeight: 1.35,
            color: "rgba(255,255,255,0.7)",
          }}
        >
          New campaigns can start automatically. An urgent favorite safely preempts, then your authorized queue resumes.
        </div>
      </Interactive.Div>

      <Interactive.Div
        name="Favorites catalog"
        style={{
          position: "absolute",
          top: 140,
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
          <div style={{ fontFamily: "system-ui", fontSize: 20, fontWeight: 800, color: "white" }}>
            Campaigns
          </div>
          <div
            style={{
              padding: "9px 15px",
              borderRadius: 999,
              backgroundColor: "rgba(250,204,21,0.12)",
              border: "1px solid rgba(250,204,21,0.25)",
              fontFamily: "system-ui",
              fontSize: 15,
              fontWeight: 800,
              color: "#fde68a",
            }}
          >
            Favorites on
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 24 }}>
          {campaigns.map((campaign, index) => (
            <div
              key={campaign.name}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "18px 20px",
                borderRadius: 18,
                backgroundColor: campaign.favorite
                  ? "rgba(145,70,255,0.18)"
                  : "rgba(255,255,255,0.05)",
                border: campaign.favorite
                  ? "1px solid rgba(169,112,255,0.45)"
                  : "1px solid rgba(255,255,255,0.08)",
                opacity: interpolate(frame, [(0.55 + index * 0.18) * fps, (1.15 + index * 0.18) * fps], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                }),
                translate: interpolate(frame, [(0.55 + index * 0.18) * fps, (1.15 + index * 0.18) * fps], ["0px 20px", "0px 0px"], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                }),
              }}
            >
              <div>
                <div style={{ fontFamily: "system-ui", fontSize: 22, fontWeight: 800, color: "white" }}>
                  {campaign.name}
                </div>
                <div style={{ marginTop: 5, fontFamily: "system-ui", fontSize: 15, color: "rgba(255,255,255,0.52)" }}>
                  {campaign.detail}
                </div>
              </div>
              <div style={{ fontSize: 34, color: campaign.favorite ? "#facc15" : "rgba(255,255,255,0.22)" }}>
                ★
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            marginTop: 22,
            padding: "16px 18px",
            borderRadius: 18,
            backgroundColor: "rgba(34,197,94,0.11)",
            border: "1px solid rgba(34,197,94,0.24)",
            opacity: interpolate(frame, [2.5 * fps, 3.15 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
            translate: interpolate(frame, [2.5 * fps, 3.15 * fps], ["0px 18px", "0px 0px"], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          <div style={{ fontSize: 26 }}>✓</div>
          <div>
            <div style={{ fontFamily: "system-ui", fontSize: 18, fontWeight: 800, color: "#bbf7d0" }}>
              Auto-started the earliest campaign
            </div>
            <div style={{ marginTop: 3, fontFamily: "system-ui", fontSize: 14, color: "rgba(255,255,255,0.56)" }}>
              Manual queue preserved for later
            </div>
          </div>
        </div>
      </Interactive.Div>
    </AbsoluteFill>
  );
};
