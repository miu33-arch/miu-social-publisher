import fs from "fs";
import path from "path";

const targets = [
  { dir: path.resolve("./outputs"), purgeAllFiles: true },
  { dir: path.resolve("./uploads"), purgeAllFiles: true },
  { dir: path.resolve("./"), purgeAllFiles: false } // Root directory: selective wipe only
];

let totalPurged = 0;

targets.forEach(({ dir, purgeAllFiles }) => {
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir);

  files.forEach((file) => {
    const fullPath = path.join(dir, file);
    if (!fs.statSync(fullPath).isFile()) return;

    // Never delete repository or configuration assets
    if (file === ".gitkeep" || file.startsWith(".env") || file === "server.js") return;

    let shouldDelete = false;

    if (purgeAllFiles) {
      // In outputs and uploads: purge all test artifacts (PDFs, ZIPs, MP4s, spreadsheets)
      shouldDelete = true;
    } else {
      // In root directory: purge leftover temp scripts or media render residue
      shouldDelete =
        (file.startsWith("output_") ||
          file.startsWith("temp_") ||
          file.startsWith("hud_overlay_") ||
          file.startsWith("final_")) &&
        (file.endsWith(".mp4") ||
          file.endsWith(".mp3") ||
          file.endsWith(".ass") ||
          file.endsWith(".wav") ||
          file.endsWith(".pdf"));
    }

    if (shouldDelete) {
      fs.unlinkSync(fullPath);
      console.log(`[PURGED] ${path.relative(process.cwd(), fullPath)}`);
      totalPurged++;
    }
  });
});

console.log(`\n✓ Sovereign Cache Reset: Wiped ${totalPurged} test artifacts from outputs, uploads, and root.`);