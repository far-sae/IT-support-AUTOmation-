/**
 * Phase 15 — Azure Monitor Data Collector API sink.
 *
 * POST to `https://${workspaceId}.ods.opinsights.azure.com/api/logs?api-version=2016-04-01`
 * with an HMAC-SHA256 signature over the request body + headers, signed by
 * `AZURE_MONITOR_SHARED_KEY` (Base64). The log type appears as a custom
 * table named `${AZURE_MONITOR_LOG_TYPE}_CL` in Log Analytics.
 *
 * Reference: https://learn.microsoft.com/azure/azure-monitor/logs/data-collector-api
 */

import crypto from "node:crypto";
import { env } from "../../env.js";
import type { LogSink, LogRecord } from "../logger.js";

function rfc1123Date(d: Date): string {
  return d.toUTCString();
}

function buildSignature(args: {
  sharedKey: string;
  contentLength: number;
  rfc1123Date: string;
}): string {
  const stringToHash = `POST\n${args.contentLength}\napplication/json\nx-ms-date:${args.rfc1123Date}\n/api/logs`;
  const decodedKey = Buffer.from(args.sharedKey, "base64");
  const hash = crypto.createHmac("sha256", decodedKey).update(stringToHash, "utf-8").digest("base64");
  return hash;
}

export const azureMonitorSink: LogSink = {
  name: "azure-monitor",
  async publish(rec: LogRecord) {
    if (!env.AZURE_MONITOR_WORKSPACE_ID || !env.AZURE_MONITOR_SHARED_KEY) return;
    // Azure Monitor expects an array of records; a single log entry is fine.
    const bodyStr = JSON.stringify([rec]);
    const contentLength = Buffer.byteLength(bodyStr, "utf-8");
    const date = rfc1123Date(new Date());
    const signature = buildSignature({
      sharedKey: env.AZURE_MONITOR_SHARED_KEY,
      contentLength,
      rfc1123Date: date,
    });
    const url = `https://${env.AZURE_MONITOR_WORKSPACE_ID}.ods.opinsights.azure.com/api/logs?api-version=2016-04-01`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "x-ms-date":     date,
        "Log-Type":      env.AZURE_MONITOR_LOG_TYPE,
        Authorization:   `SharedKey ${env.AZURE_MONITOR_WORKSPACE_ID}:${signature}`,
      },
      body: bodyStr,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Azure Monitor ${resp.status}: ${text.slice(0, 200)}`);
    }
  },
};

export function registerAzureMonitorSink(): boolean {
  if (!env.AZURE_MONITOR_WORKSPACE_ID || !env.AZURE_MONITOR_SHARED_KEY) return false;
  void import("../logger.js").then((m) => m.registerLogSink(azureMonitorSink));
  return true;
}

// Exported for unit testing the signature math.
export const _internal = { buildSignature, rfc1123Date };
