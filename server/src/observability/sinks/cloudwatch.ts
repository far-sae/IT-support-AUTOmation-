/**
 * Phase 15 — CloudWatch Logs sink + Metrics exporter.
 *
 * Logs:
 *   PutLogEvents to a configured `CLOUDWATCH_LOG_GROUP` / log stream.
 *   We batch in-memory and flush every 2 s OR when the buffer hits 100 events,
 *   whichever's first. CloudWatch wants events in ascending-timestamp order
 *   and rejects records older than 14 days / newer than 2 hours, which we
 *   trust since our logger uses Date.now().
 *
 * Metrics:
 *   On a configurable interval (CLOUDWATCH_METRICS_INTERVAL_SECONDS, default
 *   60), we walk our prom-client registry and PutMetricData each metric into
 *   `CLOUDWATCH_METRICS_NAMESPACE`.
 *
 * The AWS SDK v3 packages are loaded lazily — both are heavy and only
 * needed when these features are turned on.
 */

import { env } from "../../env.js";
import type { LogSink, LogRecord } from "../logger.js";

// ─── Logs ─────────────────────────────────────────────────────────────

interface CloudWatchLogsClient {
  send: (cmd: unknown) => Promise<unknown>;
}

let logsClient: CloudWatchLogsClient | null = null;
let sequenceToken: string | undefined;
let logBuffer: Array<{ timestamp: number; message: string }> = [];
let flushTimer: NodeJS.Timeout | null = null;

async function ensureLogsClient(): Promise<CloudWatchLogsClient | null> {
  if (logsClient) return logsClient;
  if (!env.CLOUDWATCH_LOG_GROUP) return null;
  try {
    // Dynamic import so we don't force the dependency unless used.
    const sdk = (await import("@aws-sdk/client-cloudwatch-logs")) as unknown as {
      CloudWatchLogsClient: new (cfg: { region: string }) => CloudWatchLogsClient;
      CreateLogStreamCommand: new (input: { logGroupName: string; logStreamName: string }) => unknown;
    };
    logsClient = new sdk.CloudWatchLogsClient({ region: env.AWS_REGION });
    // Best-effort: create the stream. If it already exists, AWS returns
    // ResourceAlreadyExistsException — we swallow.
    try {
      await logsClient.send(new sdk.CreateLogStreamCommand({
        logGroupName: env.CLOUDWATCH_LOG_GROUP,
        logStreamName: env.CLOUDWATCH_LOG_STREAM,
      }));
    } catch { /* already exists or no perms — log later */ }
    return logsClient;
  } catch (err) {
    process.stderr.write(`[cloudwatch] init failed: ${(err as Error).message}\n`);
    return null;
  }
}

async function flushLogBuffer(): Promise<void> {
  if (logBuffer.length === 0) return;
  const client = await ensureLogsClient();
  if (!client) { logBuffer = []; return; }
  const sdk = (await import("@aws-sdk/client-cloudwatch-logs")) as unknown as {
    PutLogEventsCommand: new (input: {
      logGroupName: string; logStreamName: string;
      logEvents: Array<{ timestamp: number; message: string }>;
      sequenceToken?: string;
    }) => unknown;
  };
  const batch = logBuffer.sort((a, b) => a.timestamp - b.timestamp);
  logBuffer = [];
  try {
    const resp = (await client.send(new sdk.PutLogEventsCommand({
      logGroupName:  env.CLOUDWATCH_LOG_GROUP!,
      logStreamName: env.CLOUDWATCH_LOG_STREAM,
      logEvents:     batch,
      sequenceToken,
    }))) as { nextSequenceToken?: string };
    sequenceToken = resp.nextSequenceToken;
  } catch (err) {
    process.stderr.write(`[cloudwatch] PutLogEvents failed: ${(err as Error).message}\n`);
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushLogBuffer();
  }, 2000);
}

export const cloudwatchLogSink: LogSink = {
  name: "cloudwatch-logs",
  async publish(rec: LogRecord) {
    if (!env.CLOUDWATCH_LOG_GROUP) return;
    logBuffer.push({ timestamp: new Date(rec.ts).getTime(), message: JSON.stringify(rec) });
    if (logBuffer.length >= 100) {
      await flushLogBuffer();
    } else {
      scheduleFlush();
    }
  },
};

export function registerCloudwatchLogSink(): boolean {
  if (!env.CLOUDWATCH_LOG_GROUP) return false;
  void import("../logger.js").then((m) => m.registerLogSink(cloudwatchLogSink));
  return true;
}

// ─── Metrics ──────────────────────────────────────────────────────────

interface CloudWatchClient {
  send: (cmd: unknown) => Promise<unknown>;
}
let metricsClient: CloudWatchClient | null = null;
let metricsTimer: NodeJS.Timeout | null = null;

async function ensureMetricsClient(): Promise<CloudWatchClient | null> {
  if (metricsClient) return metricsClient;
  if (!env.CLOUDWATCH_METRICS_NAMESPACE) return null;
  try {
    const sdk = (await import("@aws-sdk/client-cloudwatch")) as unknown as {
      CloudWatchClient: new (cfg: { region: string }) => CloudWatchClient;
    };
    metricsClient = new sdk.CloudWatchClient({ region: env.AWS_REGION });
    return metricsClient;
  } catch (err) {
    process.stderr.write(`[cloudwatch] metrics init failed: ${(err as Error).message}\n`);
    return null;
  }
}

/** Push one snapshot of the prom-client registry to CloudWatch. */
export async function pushMetricsToCloudwatch(): Promise<number> {
  if (!env.CLOUDWATCH_METRICS_NAMESPACE) return 0;
  const client = await ensureMetricsClient();
  if (!client) return 0;
  const sdk = (await import("@aws-sdk/client-cloudwatch")) as unknown as {
    PutMetricDataCommand: new (input: {
      Namespace: string;
      MetricData: Array<{
        MetricName: string;
        Value: number;
        Unit?: string;
        Timestamp?: Date;
        Dimensions?: Array<{ Name: string; Value: string }>;
      }>;
    }) => unknown;
  };
  const { default: client_, register } = (await import("prom-client")) as unknown as {
    default: unknown;
    register: { getMetricsAsJSON: () => Promise<Array<{ name: string; type: string; values: Array<{ value: number; labels?: Record<string, string> }> }>> };
  };
  void client_;
  const snapshot = await register.getMetricsAsJSON();
  // Collapse into MetricData. We cap label dimensions at 5 per AWS limits;
  // unlabeled metrics get pushed once.
  const data: Array<{ MetricName: string; Value: number; Unit?: string; Timestamp?: Date; Dimensions?: Array<{ Name: string; Value: string }> }> = [];
  const now = new Date();
  for (const m of snapshot) {
    for (const v of m.values) {
      const labelEntries = Object.entries(v.labels ?? {});
      const dims = labelEntries.length > 0
        ? labelEntries.slice(0, 5).map(([Name, Value]) => ({ Name, Value }))
        : undefined;
      data.push({
        MetricName: m.name,
        Value: typeof v.value === "number" && Number.isFinite(v.value) ? v.value : 0,
        Unit: "Count",
        Timestamp: now,
        Dimensions: dims,
      });
    }
  }
  // CloudWatch caps PutMetricData at 1000 items per call. Chunk if needed.
  const chunks: typeof data[] = [];
  for (let i = 0; i < data.length; i += 1000) chunks.push(data.slice(i, i + 1000));
  for (const chunk of chunks) {
    try {
      await client.send(new sdk.PutMetricDataCommand({
        Namespace: env.CLOUDWATCH_METRICS_NAMESPACE,
        MetricData: chunk,
      }));
    } catch (err) {
      process.stderr.write(`[cloudwatch] PutMetricData failed: ${(err as Error).message}\n`);
    }
  }
  return data.length;
}

export function startCloudwatchMetricsExporter(): void {
  if (!env.CLOUDWATCH_METRICS_NAMESPACE) return;
  if (metricsTimer) return;
  const intervalMs = env.CLOUDWATCH_METRICS_INTERVAL_SECONDS * 1000;
  metricsTimer = setInterval(() => {
    pushMetricsToCloudwatch().catch((err) =>
      process.stderr.write(`[cloudwatch] push tick failed: ${(err as Error).message}\n`),
    );
  }, intervalMs);
  // Don't keep the event loop alive on this timer alone.
  metricsTimer.unref();
  process.stdout.write(`[cloudwatch] metrics exporter started (every ${env.CLOUDWATCH_METRICS_INTERVAL_SECONDS}s, namespace=${env.CLOUDWATCH_METRICS_NAMESPACE})\n`);
}

export function stopCloudwatchMetricsExporter(): void {
  if (metricsTimer) { clearInterval(metricsTimer); metricsTimer = null; }
}
