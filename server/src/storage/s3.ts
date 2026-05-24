/**
 * Object storage — S3-compatible. In dev, points at the MinIO container
 * (force-path-style endpoint http://minio:9000). On startup `ensureBucket()`
 * creates the bucket if it doesn't already exist.
 */

import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { nanoid } from "nanoid";

import { env } from "../env.js";

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials:
        env.S3_ACCESS_KEY && env.S3_SECRET_KEY
          ? { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY }
          : undefined,
    });
  }
  return client;
}

export function storageEnabled(): boolean {
  return Boolean(env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY && env.S3_SECRET_KEY);
}

export async function ensureBucket(): Promise<void> {
  if (!storageEnabled()) {
    console.log("[storage] disabled (S3_ENDPOINT / credentials not set)");
    return;
  }
  try {
    await getClient().send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
    console.log(`[storage] bucket "${env.S3_BUCKET}" ready`);
  } catch {
    try {
      await getClient().send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
      console.log(`[storage] bucket "${env.S3_BUCKET}" created`);
    } catch (err) {
      console.error("[storage] failed to ensure bucket:", err);
    }
  }
}

export function makeStorageKey(ticketId: string, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
  return `tickets/${ticketId}/${Date.now()}-${nanoid(8)}-${safe}`;
}

export async function uploadObject(args: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: args.key,
      Body: args.body,
      ContentType: args.contentType,
    }),
  );
}

export async function presignDownload(key: string, expiresInSeconds = 300): Promise<string> {
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
    { expiresIn: expiresInSeconds },
  );
}
