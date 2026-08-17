import { fal } from "@fal-ai/client";
import { exec } from "child_process";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();
fal.config({ credentials: process.env.FAL_KEY });

// Shell command wrapper
const runCommand = (cmd) =>
  new Promise((resolve, reject) =>
    exec(cmd, (err, stdout) => (err ? reject(err) : resolve(stdout)))
  );

// Convert Whisper timestamps to ASS Subtitle Format
function generateAssSubtitles(whisperChunks) {
  let assHeader = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: TikTokStyle,Arial,65,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,0,2,10,10,250,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const formatTime = (seconds) => {
    const date = new Date(seconds * 1000);
    const hh = String(date.getUTCHours()).padStart(1, "0");
    const mm = String(date.getUTCMinutes()).padStart(2, "0");
    const ss = String(date.getUTCSeconds()).padStart(2, "0");
    const ms = String(Math.floor(date.getUTCMilliseconds() / 10)).padStart(2, "0");
    return `${hh}:${mm}:${ss}.${ms}`;
  };

  let events = "";
  whisperChunks.forEach((chunk) => {
    const start = formatTime(chunk.timestamp[0]);
    const end = formatTime(chunk.timestamp[1]);
    const text = chunk.text.trim().toUpperCase();
    events += `Dialogue: 0,${start},${end},TikTokStyle,,0,0,0,,${text}\n`;
  });

  return assHeader + events;
}

async function testSubtitlesOnly() {
  // Target existing video file
  const inputVideoPath = "./final_multi_scene_render_1786392295577.mp4";
  const audioExtractPath = "./temp_extracted_audio.mp3";
  const subtitlePath = "./temp_subtitles.ass";
  const finalOutputPath = `./final_captioned_test_${Date.now()}.mp4`;

  if (!fs.existsSync(inputVideoPath)) {
    console.error(`❌ Input video file not found: ${inputVideoPath}`);
    return;
  }

  console.log("🎵 1. Extracting audio from existing MP4...");
  await runCommand(`ffmpeg -y -i "${inputVideoPath}" -q:a 0 -map a "${audioExtractPath}"`);

  console.log("☁️ 2. Uploading audio stream to fal CDN...");
  const audioBuffer = fs.readFileSync(audioExtractPath);
  const audioBlob = new Blob([audioBuffer], { type: "audio/mp3" });
  const uploadedAudioUrl = await fal.storage.upload(audioBlob);

  console.log("📝 3. Requesting word timestamps via Whisper API (Cost: ~$0.001)...");
  const whisperResult = await fal.subscribe("fal-ai/whisper", {
    input: { audio_url: uploadedAudioUrl, chunk_level: "word" }
  });

  console.log("🎨 4. Compiling ASS Subtitle Map...");
  fs.writeFileSync(subtitlePath, generateAssSubtitles(whisperResult.data.chunks));

  console.log("🔥 5. Burning dynamic captions via FFmpeg...");
  const formattedSubPath = path.resolve(subtitlePath).replace(/\\/g, "/").replace(":", "\\:");
  await runCommand(`ffmpeg -y -i "${inputVideoPath}" -vf "ass='${formattedSubPath}'" -c:a copy "${finalOutputPath}"`);

  console.log(`\n🎉 CAPTIONING COMPLETE! Output file saved to:\n👉 ${path.resolve(finalOutputPath)}`);

  // Cleanup temporary workspace files
  [audioExtractPath, subtitlePath].forEach((p) => fs.existsSync(p) && fs.unlinkSync(p));
}

testSubtitlesOnly().catch(console.error);