import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { HttpClient } from "../src/http-client.js";

test("reintenta HTTP 429 con backoff exponencial y finalmente obtiene el PDF", async (t) => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    if (requests <= 2) {
      response.writeHead(429, { "Retry-After": "0" });
      response.end("rate limited");
      return;
    }
    response.writeHead(200, { "Content-Type": "application/pdf" });
    response.end(Buffer.from("%PDF-1.7\nfixture"));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const waits: number[] = [];
  const events: number[] = [];
  const client = new HttpClient({
    timeoutMs: 2_000,
    minDelayMs: 0,
    maxRetries: 2,
    backoffBaseMs: 10,
    random: () => 0,
    sleep: async (ms) => {
      waits.push(ms);
    },
    onRetry: (event) => events.push(event.status ?? 0),
  });

  const result = await client.getBinary(
    `http://127.0.0.1:${address.port}/resolucion.pdf`,
  );
  assert.equal(requests, 3);
  assert.deepEqual(events, [429, 429]);
  assert.deepEqual(waits, [10, 20]);
  assert.match(result.body.toString("ascii"), /^%PDF-/);
});
