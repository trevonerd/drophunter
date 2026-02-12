import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const CtaScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Logo entrance
  const logoScale = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 100 },
  });

  // Title
  const titleProgress = spring({
    frame: Math.max(0, frame - 10),
    fps,
    config: { damping: 14, stiffness: 100 },
  });
  const titleY = interpolate(titleProgress, [0, 1], [40, 0]);

  // Button
  const buttonProgress = spring({
    frame: Math.max(0, frame - 30),
    fps,
    config: { damping: 12, stiffness: 80 },
  });
  const buttonScale = interpolate(buttonProgress, [0, 1], [0.8, 1]);

  // Glow pulse
  const glowPulse = interpolate(
    Math.sin(frame * 0.06),
    [-1, 1],
    [0.4, 0.8]
  );

  // GitHub link
  const githubProgress = spring({
    frame: Math.max(0, frame - 50),
    fps,
    config: { damping: 16, stiffness: 80 },
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#0e0e10",
      }}
    >
      {/* Large background glow */}
      <div
        style={{
          position: "absolute",
          width: 800,
          height: 800,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(145,70,255,0.2) 0%, transparent 60%)",
          opacity: glowPulse,
          filter: "blur(80px)",
        }}
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
        }}
      >
        {/* Logo */}
        <div
          style={{
            transform: `scale(${logoScale})`,
            marginBottom: 30,
          }}
        >
          <Img
            src={staticFile("icon.svg")}
            style={{
              width: 120,
              height: 120,
              filter: "drop-shadow(0 0 30px rgba(145,70,255,0.5))",
            }}
          />
        </div>

        {/* Title */}
        <h2
          style={{
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: 64,
            fontWeight: 800,
            color: "white",
            margin: 0,
            opacity: titleProgress,
            transform: `translateY(${titleY}px)`,
            letterSpacing: -1,
          }}
        >
          Get{" "}
          <span
            style={{
              background: "linear-gradient(135deg, #a970ff, #772ce8)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            DropHunter
          </span>{" "}
          Today
        </h2>

        {/* CTA Button */}
        <div
          style={{
            marginTop: 40,
            opacity: buttonProgress,
            transform: `scale(${buttonScale})`,
          }}
        >
          <div
            style={{
              background: "linear-gradient(135deg, #9146ff, #772ce8)",
              padding: "18px 60px",
              borderRadius: 16,
              boxShadow: `0 0 40px rgba(145,70,255,${glowPulse * 0.5})`,
            }}
          >
            <span
              style={{
                fontFamily:
                  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                fontSize: 28,
                fontWeight: 700,
                color: "white",
                letterSpacing: 0.5,
              }}
            >
              Free on Chrome Web Store
            </span>
          </div>
        </div>

        {/* GitHub */}
        <div
          style={{
            marginTop: 30,
            opacity: githubProgress,
          }}
        >
          <span
            style={{
              fontFamily:
                '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontSize: 20,
              color: "rgba(255,255,255,0.4)",
              fontWeight: 400,
            }}
          >
            Open Source on GitHub
          </span>
        </div>

        {/* Version badge */}
        <div
          style={{
            marginTop: 60,
            opacity: githubProgress * 0.6,
          }}
        >
          <span
            style={{
              fontFamily:
                '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontSize: 14,
              color: "rgba(255,255,255,0.25)",
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
          >
            v1.5.0 &middot; Chrome &amp; Brave
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
