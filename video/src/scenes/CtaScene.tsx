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

  const subtitleProgress = spring({
    frame: Math.max(0, frame - 18),
    fps,
    config: { damping: 16, stiffness: 90 },
  });
  const subtitleY = interpolate(subtitleProgress, [0, 1], [22, 0]);

  // Button
  const buttonProgress = spring({
    frame: Math.max(0, frame - 34),
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
    frame: Math.max(0, frame - 56),
    fps,
    config: { damping: 16, stiffness: 80 },
  });

  const badgeProgress = spring({
    frame: Math.max(0, frame - 70),
    fps,
    config: { damping: 18, stiffness: 85 },
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
            fontSize: 62,
            fontWeight: 800,
            color: "white",
            margin: 0,
            opacity: titleProgress,
            transform: `translateY(${titleY}px)`,
            letterSpacing: -1,
            lineHeight: 1.02,
          }}
        >
          Queue campaigns.
          <br />
          <span
            style={{
              background: "linear-gradient(135deg, #a970ff, #772ce8)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Monitor drops.
          </span>
          <br />
          Recover playback fast.
        </h2>

        <p
          style={{
            maxWidth: 900,
            marginTop: 24,
            marginBottom: 0,
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: 22,
            lineHeight: 1.45,
            color: "rgba(255,255,255,0.72)",
            opacity: subtitleProgress,
            transform: `translateY(${subtitleY}px)`,
          }}
        >
          Live monitor, smarter stream rotation, playback recovery alerts, and monitor auto-open settings.
        </p>

        {/* CTA Button */}
        <div
          style={{
            marginTop: 36,
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
                fontSize: 26,
                fontWeight: 700,
                color: "white",
                letterSpacing: 0.5,
              }}
            >
              Install DropHunter for Chrome
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
              fontSize: 19,
              color: "rgba(255,255,255,0.4)",
              fontWeight: 400,
            }}
          >
            Open source. Built for Twitch Drops power users.
          </span>
        </div>

        {/* Version badge */}
        <div
          style={{
            marginTop: 54,
            opacity: badgeProgress * 0.7,
            transform: `translateY(${interpolate(badgeProgress, [0, 1], [12, 0])}px)`,
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
            v1.7.0 &middot; Live Monitor &amp; Smart Recovery
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
