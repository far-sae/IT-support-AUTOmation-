/**
 * Phase 18 — Vendor mock-server harness.
 *
 * Boots a tiny HTTP server on an ephemeral port for the duration of one test.
 * Tests run the REAL integration client (the same code that talks to PaloAlto,
 * ServiceNow, etc. in production) against this mock, which implements the
 * vendor's documented API contract — auth flow, status codes, payload shape.
 *
 * This is meaningfully stronger than the `global.fetch = vi.fn()` style we
 * used in earlier phases: a missing `Authorization` header or wrong content
 * type would silently pass the fetch-mock, but is caught here because the
 * mock asserts on the actual HTTP request.
 *
 * Usage:
 *
 *   await withMockServer(async ({ baseUrl, requests }) => {
 *     // ... call the integration ...
 *     expect(requests).toHaveLength(1);
 *     expect(requests[0].headers.authorization).toBe("Bearer ...");
 *   }, { handler: (req, res, body) => { ... } });
 */

import http from "node:http";
import type { AddressInfo } from "node:net";

export interface CapturedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  parsedBody: unknown;
}

export interface MockServerCtx {
  baseUrl: string;
  /** Every inbound request, in order received. */
  requests: CapturedRequest[];
}

export interface MockHandler {
  (req: CapturedRequest, res: http.ServerResponse): Promise<void> | void;
}

export interface MockServerOpts {
  handler: MockHandler;
}

/**
 * Start a mock server, run `fn(ctx)`, then tear down. Returns whatever `fn`
 * returned (so a test can yield assertions back).
 */
export async function withMockServer<T>(
  fn: (ctx: MockServerCtx) => Promise<T> | T,
  opts: MockServerOpts,
): Promise<T> {
  const requests: CapturedRequest[] = [];

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf-8");
      let parsedBody: unknown = null;
      if (body.length > 0) {
        try { parsedBody = JSON.parse(body); } catch { parsedBody = body; }
      }
      // Normalize headers to lowercase string-to-string for ergonomics.
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string") headers[k.toLowerCase()] = v;
        else if (Array.isArray(v)) headers[k.toLowerCase()] = v.join(", ");
      }
      const captured: CapturedRequest = {
        method: req.method ?? "GET",
        url: req.url ?? "/",
        headers,
        body,
        parsedBody,
      };
      requests.push(captured);
      Promise.resolve(opts.handler(captured, res)).catch((err) => {
        if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(`mock-handler-threw: ${(err as Error).message}`);
      });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    return await fn({ baseUrl, requests });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

/** Convenience for the common "return JSON with this body" case. */
export function jsonResponse(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Convenience for "return plain text". */
export function textResponse(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "Content-Type": "text/plain" });
  res.end(body);
}
