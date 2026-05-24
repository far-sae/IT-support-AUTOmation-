/**
 * Phase 12 — Kafka adapter for the event bus.
 *
 * Real `kafkajs` Producer, wrapped so the rest of the app never imports
 * kafkajs directly. The adapter only activates when KAFKA_BROKERS is set —
 * local dev and tests bypass it entirely.
 *
 * Topic naming: `${KAFKA_TOPIC_PREFIX}${event.kind}` (default "relay.ticket.created").
 *
 * Each event publishes a JSON-encoded message keyed by organizationId so a
 * downstream consumer can repartition cleanly per tenant.
 */

import type { Kafka, Producer } from "kafkajs";
import { env } from "../env.js";
import type { EventSink, RelayEvent } from "../events/bus.js";

let producer: Producer | null = null;

async function ensureProducer(): Promise<Producer | null> {
  if (producer) return producer;
  if (!env.KAFKA_BROKERS) return null;

  // Lazy import so kafkajs doesn't load unless configured.
  const { Kafka: KafkaClass } = (await import("kafkajs")) as unknown as {
    Kafka: new (opts: { clientId: string; brokers: string[] }) => Kafka;
  };
  const kafka = new KafkaClass({
    clientId: env.KAFKA_CLIENT_ID,
    brokers: env.KAFKA_BROKERS.split(",").map((b) => b.trim()).filter(Boolean),
  });
  producer = kafka.producer({ allowAutoTopicCreation: true });
  await producer.connect();
  console.log(`[kafka] connected to ${env.KAFKA_BROKERS}`);
  return producer;
}

/** Sink that mirrors every RelayEvent onto Kafka. */
export const kafkaSink: EventSink = {
  name: "kafka",
  async publish(ev: RelayEvent): Promise<void> {
    const p = await ensureProducer();
    if (!p) return;
    const topic = `${env.KAFKA_TOPIC_PREFIX}${ev.kind}`;
    await p.send({
      topic,
      messages: [{
        key: ev.organizationId,
        value: JSON.stringify({ ...ev, _ts: Date.now() }),
      }],
    });
  },
};

/**
 * Wire Kafka into the global bus if env is configured. Safe to call multiple
 * times — no-op without env.
 */
export async function registerKafkaSink(): Promise<boolean> {
  if (!env.KAFKA_BROKERS) return false;
  // Touch the producer once so connection happens at boot.
  await ensureProducer();
  const { bus } = await import("../events/bus.js");
  bus.registerSink(kafkaSink);
  return true;
}

/** Graceful disconnect — used in tests + on SIGTERM. */
export async function disconnectKafka(): Promise<void> {
  if (producer) {
    await producer.disconnect();
    producer = null;
  }
}
