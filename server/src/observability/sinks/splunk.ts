/**
 * Phase 15 — Splunk HEC (HTTP Event Collector) sink.
 *
 * Splunk expects a JSON envelope `{ event, sourcetype, index, host, time }`
 * POSTed to `${SPLUNK_HEC_URL}/services/collector/event` with `Authorization:
 * Splunk <token>`.
 *
 * https://docs.splunk.com/Documentation/Splunk/9.3.0/Data/UseHEC
 */

import { env } from "../../env.js";
import type { LogSink, LogRecord } from "../logger.js";

const hostname = process.env.HOSTNAME ?? "relay-server";

export const splunkSink: LogSink = {
  name: "splunk",
  async publish(rec: LogRecord) {
    if (!env.SPLUNK_HEC_URL || !env.SPLUNK_HEC_TOKEN) return;
    const url = `${env.SPLUNK_HEC_URL.replace(/\/$/, "")}/services/collector/event`;
    const body = {
      event: rec,
      sourcetype: "relay:log",
      ...(env.SPLUNK_HEC_INDEX ? { index: env.SPLUNK_HEC_INDEX } : {}),
      host: hostname,
      // Splunk wants epoch seconds (float). The record has ISO ts.
      time: new Date(rec.ts).getTime() / 1000,
    };
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        Authorization:   `Splunk ${env.SPLUNK_HEC_TOKEN}`,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Splunk HEC ${resp.status}: ${text.slice(0, 200)}`);
    }
  },
};

export function registerSplunkSink(): boolean {
  if (!env.SPLUNK_HEC_URL || !env.SPLUNK_HEC_TOKEN) return false;
  void import("../logger.js").then((m) => m.registerLogSink(splunkSink));
  return true;
}
