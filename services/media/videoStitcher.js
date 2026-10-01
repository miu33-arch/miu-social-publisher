import { exec } from "child_process";
import fs from "fs";
import path from "path";

const runCommand = (cmd) => {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve(stdout);
    });
  });
};

export async function stitchMasterWalkthrough(params = {}) {
  const rawClips = params.clipPaths || params.clips || ["miu33.mp4"];
  const safeClips = Array.isArray(rawClips) ? rawClips : [rawClips];
  
  const timestamp = Date.now();
  const concatListPath = path.resolve(`./concat_${timestamp}.txt`);
  const tempMergedVideo = path.resolve(`./temp_raw_stitched_${timestamp}.mp4`);
  const finalMasterPath = path.resolve(params.outputPath || `./output_stitched_${timestamp}.mp4`);

  try {
    // 1. Validate files on disk
    const validClips = safeClips.filter((p) => {
      const exists = fs.existsSync(p) || fs.existsSync(path.resolve(String(p)));
      if (!exists) console.warn(`⚠️ Warning: Clip path not found on disk: ${p}`);
      return exists;
    });

    if (validClips.length === 0) {
      throw new Error(`None of the specified clip paths exist on disk: ${safeClips.join(", ")}`);
    }

    // 2. Write playlist safely for FFmpeg
    const concatContent = validClips
      .map((p) => `file '${path.resolve(String(p)).replace(/\\/g, "/")}'`)
      .join("\n");
    
    fs.writeFileSync(concatListPath, concatContent, "utf8");

    // 3. Concatenate video stream
    await runCommand(`ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c copy "${tempMergedVideo}"`);

    // 4. Subtitle and audio handling
    if (params.subtitlePath && fs.existsSync(params.subtitlePath)) {
      const formattedSubPath = path.resolve(params.subtitlePath).replace(/\\/g, "/").replace(":", "\\:");
      if (params.audioPath && fs.existsSync(params.audioPath)) {
        await runCommand(
          `ffmpeg -y -i "${tempMergedVideo}" -i "${path.resolve(params.audioPath)}" -vf "ass='${formattedSubPath}'" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "${finalMasterPath}"`
        );
      } else {
        await runCommand(
          `ffmpeg -y -i "${tempMergedVideo}" -vf "ass='${formattedSubPath}'" -c:v libx264 -pix_fmt yuv420p -an "${finalMasterPath}"`
        );
      }
    } else {
      await runCommand(`ffmpeg -y -i "${tempMergedVideo}" -c:v copy "${finalMasterPath}"`);
    }

    return {
      success: true,
      stitchedPath: finalMasterPath,
      totalClips: validClips.length,
      timestamp: new Date().toISOString()
    };
  } finally {
    // Clean temporary staging files
    if (fs.existsSync(concatListPath)) fs.unlinkSync(concatListPath);
    if (fs.existsSync(tempMergedVideo)) fs.unlinkSync(tempMergedVideo);
  }
}