/**
 * Phase 15 — Elasticsearch log sink.
 *
 * Indexes server logs to `${ELASTICSEARCH_LOGS_PREFIX}-YYYY.MM.DD`. The
 * daily rolling index pattern is what Logstash / Filebeat default to and
 * lets Curator / ILM age them out by day.
 *
 * Reuses the Phase-12 ES client (no extra dependency).
 */

import { env } from "../../env.js";
import { getEsClient, esEnabled } from "../../integrations/elasticsearch.js";
import type { LogSink, LogRecord } from "../logger.js";

function dailyIndex(d: Date = new Date()): string {
  // YYYY.MM.DD per Kibana convention.
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${env.ELASTICSEARCH_LOGS_PREFIX}-${y}.${m}.${dd}`;
}

export const esLogSink: LogSink = {
  name: "elasticsearch-logs",
  async publish(rec: LogRecord) {
    const es = await getEsClient();
    if (!es) return;
    await es.index({
      index: dailyIndex(new Date(rec.ts)),
      document: rec,
    });
  },
};

export async function registerEsLogSink(): Promise<boolean> {
  if (!esEnabled()) return false;
  const { registerLogSink } = await import("../logger.js");
  registerLogSink(esLogSink);
  return true;
}
