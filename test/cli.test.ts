import assert from "node:assert/strict";
import test from "node:test";
import { parseCli } from "../src/cli.js";

test("interpreta límites, filtros y modo sin descarga", () => {
  const result = parseCli(
    [
      "--source",
      "oefa",
      "--max-pages=2",
      "--filter",
      "txtNroexp=123-2024",
      "--no-download",
      "--delay-ms",
      "0",
    ],
    "C:/workspace",
  );
  assert.equal(result.config.source.name, "oefa");
  assert.equal(result.config.maxPages, 2);
  assert.deepEqual(result.config.filters, { txtNroexp: "123-2024" });
  assert.equal(result.config.downloadPdfs, false);
  assert.equal(result.config.requestDelayMs, 0);
});

test("rechaza filtros sin campo", () => {
  assert.throws(() => parseCli(["--filter", "=valor"]), /campo=valor/);
});

test("configura proxy peruano gratuito y valida exclusión mutua", () => {
  const free = parseCli(["--source", "pj", "--free-proxy-peru"]);
  assert.equal(free.config.freePeruProxy, true);

  const explicit = parseCli(["--proxy", "proxy.example:8080"]);
  assert.equal(explicit.config.proxyUrl, "http://proxy.example:8080/");
  assert.throws(
    () =>
      parseCli([
        "--proxy",
        "http://proxy.example:8080",
        "--free-proxy-peru",
      ]),
    /no ambos/,
  );
});
