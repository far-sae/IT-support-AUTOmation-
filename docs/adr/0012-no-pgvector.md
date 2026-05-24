# ADR 0012 — No pgvector — hashed local embeddings stored as JSON

**Status:** Accepted
**Date:** 2026-05-27

## Context

The brain wants semantic similarity over resolved tickets ("did we see
something like this before?"). Real embeddings (Voyage, OpenAI ada,
Anthropic) plus pgvector is the modern default — but adds two
dependencies (an embedder API + a Postgres extension).

## Options considered

- **OpenAI embeddings + pgvector** — best quality, but ties us to an API
  and requires a non-default Postgres extension.
- **Self-hosted embedder + pgvector** — quality is good (`bge-small`,
  `nomic`) but needs a GPU host.
- **Hashed feature embeddings + cosine in Node** — deterministic, free,
  works without infrastructure. Lower quality but acceptable for our
  use case (memory recall of similar past tickets is a hint to the brain,
  not the source of truth).

## Decision

Phase 11 ships option 3: `server/src/memory/embeddings.ts` is a 256-dim
hashed FNV embedding, L2-normalised. Vectors are stored as JSON arrays
on `TicketEmbedding.vector`. The cosine search reads up to 1000 rows
per query (capped to keep latency bounded) and ranks in Node.

We expose `model` column on `TicketEmbedding` so we can re-index when
we adopt a real embedder later.

## Consequences

### Positive
- Zero new infrastructure.
- Search latency is dominated by the Postgres scan, not embedder calls.
- Tested cheaply — the embedder is deterministic.

### Negative
- Semantic quality is lower than a real embedder. "MFA reset" and "two
  factor auth" don't share many tokens.
- Cosine in Node doesn't scale beyond ~10k vectors per org without
  approximate-nearest-neighbour. We cap the candidate set at 1000.

### Follow-ups
- When a customer's tenant exceeds ~5k resolved tickets, switch to a
  real embedder + pgvector via the `model` discriminator.
