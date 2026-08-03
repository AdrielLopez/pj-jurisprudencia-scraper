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
