// services/media/hudTelemetry.js
import fs from "fs";
import path from "path";

/**
 * Generates an Advanced SubStation Alpha (.ass) subtitle file formatted
 * with AEC / BIM HUD telemetry, survey waypoints, and municipal inspection tags.
 */
export function generateArchitecturalHud({
  shots = [],
  projectTitle = "MOMRAH CENTRAL TOWER",
  outputPath,
  aspectRatio = "16:9",
  is4K = false,
  shotDuration = 5,
  duration
}) {
  const isPortrait = aspectRatio === "9:16";

  // Dynamic Resolution Matrix
  let resX, resY;
  if (isPortrait) {
    resX = is4K ? 2160 : 1080;
    resY = is4K ? 3840 : 1920;
  } else {
    resX = is4K ? 3840 : 1920;
    resY = is4K ? 2160 : 1080;
  }

  // Adaptive Font Sizing based on resolution & orientation
  const scaleFactor = is4K ? 2 : 1;
  const headerFontSize = (isPortrait ? 24 : 20) * scaleFactor;
  const telemetryFontSize = (isPortrait ? 22 : 16) * scaleFactor;
  const statusFontSize = (isPortrait ? 18 : 14) * scaleFactor;
  const marginSize = 40 * scaleFactor;

  // ASS Style Color Scheme (AABBGGRR in hexadecimal)
  // Primary Cyan: &H00F8BD38 | Status Green: &H0080DE4A | Dark Box Alpha: &H80000000
  const assHeader = `[Script Info]
Title: MIU Sovereign AEC Site Telemetry HUD
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
PlayResX: ${resX}
PlayResY: ${resY}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: HeaderHUD,JetBrains Mono,${headerFontSize},&H00F8BD38,&H00000000,&H00000000,&H80000000,1,0,0,0,100,100,1,0,3,4,0,7,${marginSize},${marginSize},${marginSize},1
Style: TelemetryBox,JetBrains Mono,${telemetryFontSize},&H00FFFFFF,&H00000000,&H00000000,&H90000000,1,0,0,0,100,100,1,0,3,4,0,1,${marginSize},${marginSize},${marginSize},1
Style: StatusHUD,JetBrains Mono,${statusFontSize},&H0080DE4A,&H00000000,&H00000000,&H80000000,1,0,0,0,100,100,1,0,3,3,0,3,${marginSize},${marginSize},${marginSize},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const formatCentiseconds = (seconds) => {
    const totalMs = Math.floor(seconds * 1000);
    const mm = String(Math.floor((totalMs / 60000) % 60)).padStart(2, "0");
    const ss = String(Math.floor((totalMs / 1000) % 60)).padStart(2, "0");
    const cs = String(Math.floor((totalMs % 1000) / 10)).padStart(2, "0");
    return `0:${mm}:${ss}.${cs}`;
  };

  const shotLen = Number(shotDuration) || 5;
  const computedTotal = shots.length > 0 ? shots.length * shotLen : 30;
  const finalDuration = Number(duration) || computedTotal;
  const totalTimeStr = formatCentiseconds(finalDuration);
  const safeTitle = (projectTitle || "MUNICIPAL INSPECTION RUN").toUpperCase();

  let events = "";

  // 1. Persistent Top Header Watermark (Top-Left // Alignment 7)
  events += `Dialogue: 0,0:00:00.00,${totalTimeStr},HeaderHUD,,0,0,0,,{\\b1}SOVEREIGN AEC // TELEMETRY HUD{\\b0} | ${safeTitle}\n`;

  // 2. Persistent Municipal System Status Tag (Bottom-Right // Alignment 3)
  events += `Dialogue: 0,0:00:00.00,${totalTimeStr},StatusHUD,,0,0,0,,{\\b1}STATUS:{\\b0} MUNICIPAL MILESTONE VERIFIED [${is4K ? "4K UHD" : "1080P"}]\n`;

  // 3. Sequenced Survey Telemetry Waypoints (Bottom-Left // Alignment 1)
  shots.forEach((shot, idx) => {
    const startSec = idx * shotLen;
    const endSec = Math.min(startSec + shotLen, finalDuration);
    if (startSec >= finalDuration) return;

    const startStr = formatCentiseconds(startSec);
    const endStr = formatCentiseconds(endSec);
    const label = shot.hudLabel || shot.shotType || `WAYPOINT 0${idx + 1}`;

    events += `Dialogue: 1,${startStr},${endStr},TelemetryBox,,0,0,0,,{\\fad(250,250)}${label}\n`;
  });

  const resolvedPath = path.resolve(outputPath);
  fs.writeFileSync(resolvedPath, assHeader + events, "utf8");
  return resolvedPath;
}