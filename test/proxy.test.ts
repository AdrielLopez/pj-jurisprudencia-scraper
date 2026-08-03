import assert from "node:assert/strict";
import test from "node:test";
import { extractTextProxies, parseProxyEndpoint } from "../src/proxy.js";

test("normaliza proxies HTTP y oculta credenciales en la etiqueta", () => {
  const endpoint = parseProxyEndpoint(
    "http://usuario:secreto@proxy.example:8080",
  );
  assert.equal(endpoint.label, "proxy.example:8080");
  assert.deepEqual(endpoint.axios.auth, {
    username: "usuario",
    password: "secreto",
  });

  const defaultPort = parseProxyEndpoint("http://168.121.222.230:80");
  assert.equal(defaultPort.axios.port, 80);
});

test("extrae candidatos con o sin protocolo", () => {
  const proxies = extractTextProxies(`
    # comentario
    161.132.180.10:999
    http://177.67.250.222:8080
  `);
  assert.deepEqual(proxies, [
    "http://161.132.180.10:999",
    "http://177.67.250.222:8080",
  ]);
});
