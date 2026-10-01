// services/cloud/s3Dispatcher.js
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs from "fs";
import path from "path";

const s3 = new S3Client({
  region: process.env.S3_REGION || "auto",
  endpoint: process.env.S3_ENDPOINT, // e.g., Cloudflare R2: https://<id>.r2.cloudflarestorage.com
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || ""
  }
});

export async function uploadDossierAndGetPresignedUrl(filePath, projectCode) {
  const fileName = path.basename(filePath);
  const fileStream = fs.createReadStream(filePath);
  const key = `dossiers/${projectCode}/${fileName}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME || "miu-aec-dossiers",
      Key: key,
      Body: fileStream,
      ContentType: "application/zip"
    })
  );

  // Generate a 24-hour signed download link for municipal engineers
  const downloadUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME || "miu-aec-dossiers",
      Key: key
    }),
    { expiresIn: 86400 }
  );

  return { key, downloadUrl };
}