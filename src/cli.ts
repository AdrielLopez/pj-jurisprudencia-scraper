import path from "node:path";
import { customProfile, getProfile } from "./profiles.js";
import { parseProxyEndpoint } from "./proxy.js";
import type { ScraperConfig } from "./types.js";
import { parsePositiveInteger } from "./utils.js";

export interface CliResult {
  config: ScraperConfig;
  debug: boolean;
  help: boolean;
}

export function parseCli(argv: string[], cwd = process.cwd()): CliResult {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const filters: Record<string, string> = {};
  const valueOptions = new Set([
    "source",
    "url",
    "output-dir",
    "max-pages",
    "max-documents",
    "delay-ms",
    "request-timeout-ms",
    "retries",
    "backoff-ms",
    "filter",
    "table-selector",
    "proxy",
  ]);
  const booleanOptions = new Set([
    "no-download",
    "retry-failed",
    "debug",
    "help",
    "h",
    "free-proxy-peru",
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument?.startsWith("--") && argument !== "-h") {
      throw new Error(`Argumento inesperado: ${argument ?? ""}`);
    }
    if (argument === "-h") {
      flags.add("help");
      continue;
    }
    const withoutPrefix = argument.slice(2);
    const equalAt = withoutPrefix.indexOf("=");
    const name = equalAt >= 0 ? withoutPrefix.slice(0, equalAt) : withoutPrefix;
    if (booleanOptions.has(name)) {
      if (equalAt >= 0) throw new Error(`--${name} no acepta un valor`);
      flags.add(name === "h" ? "help" : name);
      continue;
    }
    if (!valueOptions.has(name)) throw new Error(`Opción desconocida: --${name}`);
    const value =
      equalAt >= 0 ? withoutPrefix.slice(equalAt + 1) : argv[index + 1];
    if (!value || (equalAt < 0 && value.startsWith("--"))) {
      throw new Error(`Falta el valor de --${name}`);
    }
    if (equalAt < 0) index += 1;
    if (name === "filter") {
      const separator = value.indexOf("=");
      if (separator <= 0) {
        throw new Error('--filter debe tener el formato "campo=valor"');
      }
      filters[value.slice(0, separator)] = value.slice(separator + 1);
    } else {
      values.set(name, value);
    }
  }

  const sourceName = values.get("source") ?? "pj";
  if (sourceName !== "pj" && sourceName !== "oefa") {
    throw new Error('--source debe ser "pj" u "oefa"');
  }
  const customUrl = values.get("url");
  if (customUrl) {
    try {
      new URL(customUrl);
    } catch {
      throw new Error("--url debe ser una URL absoluta válida");
    }
  }
  const profile = customUrl
    ? customProfile(customUrl)
    : getProfile(sourceName);
  const maxPages = parsePositiveInteger(
    "--max-pages",
    values.get("max-pages"),
  );
  const maxDocuments = parsePositiveInteger(
    "--max-documents",
    values.get("max-documents"),
  );
  const requestDelayMs = parseNonNegativeInteger(
    "--delay-ms",
    values.get("delay-ms") ?? "1200",
  );
  const requestTimeoutMs = parsePositiveInteger(
    "--request-timeout-ms",
    values.get("request-timeout-ms") ?? "30000",
  ) as number;
  const maxRetries = parseNonNegativeInteger(
    "--retries",
    values.get("retries") ?? "5",
  );
  const backoffBaseMs = parsePositiveInteger(
    "--backoff-ms",
    values.get("backoff-ms") ?? "2000",
  ) as number;
  const tableSelector = values.get("table-selector");
  const proxy = values.get("proxy");
  if (proxy && flags.has("free-proxy-peru")) {
    throw new Error("Usa --proxy o --free-proxy-peru, no ambos");
  }
  const proxyUrl = proxy ? parseProxyEndpoint(proxy).url : undefined;

  return {
    config: {
      source: profile,
      outputDir: path.resolve(cwd, values.get("output-dir") ?? "output"),
      downloadPdfs: !flags.has("no-download"),
      retryFailedOnly: flags.has("retry-failed"),
      ...(maxPages !== undefined ? { maxPages } : {}),
      ...(maxDocuments !== undefined ? { maxDocuments } : {}),
      requestDelayMs,
      requestTimeoutMs,
      maxRetries,
      backoffBaseMs,
      filters,
      ...(tableSelector ? { tableSelector } : {}),
      ...(proxyUrl ? { proxyUrl } : {}),
      freePeruProxy: flags.has("free-proxy-peru"),
    },
    debug: flags.has("debug"),
    help: flags.has("help"),
  };
}

function parseNonNegativeInteger(name: string, raw: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} debe ser un entero mayor o igual que cero`);
  }
  return parsed;
}

export const HELP = `
Scraper de Jurisprudencia del Poder Judicial del Perú

Uso:
  npm start -- [opciones]

Opciones:
  --source pj|oefa          Fuente preconfigurada (predeterminado: pj)
  --url URL                 Endpoint JSF personalizado
  --output-dir RUTA         Directorio de salida (predeterminado: output)
  --max-pages N             Procesar como máximo N páginas
  --max-documents N         Procesar como máximo N documentos
  --delay-ms N              Pausa mínima entre solicitudes (predeterminado: 1200)
  --request-timeout-ms N    Timeout HTTP (predeterminado: 30000)
  --retries N               Reintentos adicionales por 429/5xx (predeterminado: 5)
  --backoff-ms N            Base del backoff exponencial (predeterminado: 2000)
  --filter campo=valor      Aplicar filtro; puede repetirse
  --table-selector CSS      Forzar el selector CSS de la tabla de resultados
  --proxy URL               Proxy HTTP(S) estable, por ejemplo http://host:puerto
  --free-proxy-peru         Descubrir y rotar proxies públicos de Perú
  --no-download             Extraer metadatos sin descargar PDFs
  --retry-failed            Recorrer el sitio y descargar solo la cola de fallos
  --debug                    Mostrar diagnóstico adicional
  -h, --help                 Mostrar esta ayuda

Ejemplos:
  npm start -- --source pj --max-pages 2
  npm start -- --source pj --free-proxy-peru --max-pages 1
  npm start -- --source oefa --no-download --max-pages 1
  npm start -- --source pj --retry-failed
  npm start -- --source pj --filter txtBusqueda=casacion
`;
