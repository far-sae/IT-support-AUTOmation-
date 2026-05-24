/**
 * Phase 15 — Structured JSON logger.
 *
 * Every log record is `{ ts, level, service, msg, ...meta }` and is written
 * to stdout in JSON form so container-runtime log collectors (Docker, K8s,
 * Fluent Bit) ingest it naturally.
 *
 * Pluggable sinks fan out the same record to ES / Splunk / CloudWatch /
 * Azure Monitor. Sink failures are swallowed — a downstream outage cannot
 * break the request that emitted the log.
 *
 * Usage:
 *   import { log } from "./observability/logger.js";
 *   log.info("ticket created", { ticketId, refCode });
 *   log.error("brain failed", err, { ticketId });
 */

import { env } from "../env.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogRecord {
  ts: string;          // ISO 8601
  level: LogLevel;
  service: string;     // always "relay-server"
  msg: string;
  /** Free-form structured fields. */
  [key: string]: unknown;
}

export interface LogSink {
  name: string;
  publish: (rec: LogRecord) => Promise<void>;
}

const sinks: LogSink[] = [];

export function registerLogSink(sink: LogSink): void {
  sinks.push(sink);
  // Use stdout directly so the registration message itself can be ingested
  // by any sink that just registered.
  process.stdout.write(JSON.stringify({
    ts: new Date().toISOString(), level: "info", service: "relay-server",
    msg: `[logger] registered sink '${sink.name}'`,
  }) + "\n");
}

/** Internal — drains a record to stdout + every registered sink. */
function publish(rec: LogRecord): void {
  if (LEVEL_ORDER[rec.level] < LEVEL_ORDER[env.LOG_LEVEL]) return;
  // Always write JSON to stdout first — guarantees the record exists even
  // if every sink is broken.
  process.stdout.write(JSON.stringify(rec) + "\n");
  for (const sink of sinks) {
    sink.publish(rec).catch((err) => {
      // No further logging — would loop.
      process.stderr.write(`[logger] sink '${sink.name}' failed: ${(err as Error).message}\n`);
    });
  }
}

function record(level: LogLevel, msg: string, meta?: Record<string, unknown>): LogRecord {
  return {
    ts: new Date().toISOString(),
    level,
    service: "relay-server",
    msg,
    ...(meta ?? {}),
  };
}

export const log = {
  debug(msg: string, meta?: Record<string, unknown>): void { publish(record("debug", msg, meta)); },
  info (msg: string, meta?: Record<string, unknown>): void { publish(record("info",  msg, meta)); },
  warn (msg: string, meta?: Record<string, unknown>): void { publish(record("warn",  msg, meta)); },
  error(msg: string, err?: unknown, meta?: Record<string, unknown>): void {
    const errMeta = err
      ? {
          errorMessage: (err as Error).message ?? String(err),
          errorStack:   (err as Error).stack,
          errorName:    (err as Error).name,
        }
      : {};
    publish(record("error", msg, { ...errMeta, ...(meta ?? {}) }));
  },
};

/** Test/observability helper — read-only view of how many sinks are active. */
export function sinkCount(): number {
  return sinks.length;
}
