import axios, { type AxiosProxyConfig } from "axios";
import { load } from "cheerio";

export interface ProxyEndpoint {
  axios: AxiosProxyConfig;
  label: string;
  url: string;
}

export interface ProxyDiscoveryEvent {
  source: string;
  reason: string;
}

interface ProxyDiscoveryOptions {
  timeoutMs?: number;
  onSourceError?: (event: ProxyDiscoveryEvent) => void;
}

const DISCOVERY_USER_AGENT =
  "Mozilla/5.0 (compatible; PJ-Jurisprudencia-Scraper/1.0; +https://github.com/AdrielLopez/pj-jurisprudencia-scraper)";

const TEXT_SOURCES = [
  {
    name: "Databay",
    url: "https://databay.com/free-proxy-list/peru.txt",
  },
  {
    name: "ProxyScrape",
    url: "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&country=pe&protocol=http&proxy_format=protocolipport&format=text&timeout=20000",
  },
] as const;

const GEONODE_SOURCE = {
  name: "GeoNode",
  url: "https://proxylist.geonode.com/api/proxy-list?country=PE&limit=100&page=1&sort_by=lastChecked&sort_type=desc",
} as const;

const LITPORT_SOURCE = {
  name: "Litport",
  url: "https://litport.net/free-proxy/peru",
} as const;

export function parseProxyEndpoint(raw: string): ProxyEndpoint {
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw)
    ? raw
    : `http://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`Proxy inválido: ${raw}`);
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error("El proxy debe usar el protocolo http:// o https://");
  }
  if (!parsed.hostname) {
    throw new Error("El proxy debe tener el formato http://host:puerto");
  }

  const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Puerto de proxy inválido: ${parsed.port}`);
  }

  const protocol = parsed.protocol.slice(0, -1) as "http" | "https";
  const auth =
    parsed.username || parsed.password
      ? {
          username: decodeURIComponent(parsed.username),
          password: decodeURIComponent(parsed.password),
        }
      : undefined;
  return {
    axios: {
      protocol,
      host: parsed.hostname,
      port,
      ...(auth ? { auth } : {}),
    },
    label: `${parsed.hostname}:${port}`,
    url: parsed.toString(),
  };
}

export async function discoverFreePeruProxies(
  options: ProxyDiscoveryOptions = {},
): Promise<string[]> {
  const timeout = options.timeoutMs ?? 15_000;
  const commonConfig = {
    timeout,
    responseType: "text" as const,
    headers: { "User-Agent": DISCOVERY_USER_AGENT },
  };

  const requests: Array<Promise<{ source: string; proxies: string[] }>> = [
    (async () => {
      try {
        const response = await axios.get<string>(LITPORT_SOURCE.url, commonConfig);
        const $ = load(String(response.data));
        const proxies: string[] = [];
        $("tr.proxy-row").each((_, element) => {
          const cells = $(element).children("td");
          const protocol = cells.eq(0).text().trim().toLowerCase();
          if (protocol !== "http" && protocol !== "https") return;
          const ip = cells
            .eq(1)
            .clone()
            .children()
            .remove()
            .end()
            .text()
            .trim();
          const port = cells.eq(2).text().trim();
          if (isHostPort(`${ip}:${port}`)) {
            proxies.push(`${protocol}://${ip}:${port}`);
          }
        });
        return { source: LITPORT_SOURCE.name, proxies };
      } catch (error) {
        options.onSourceError?.({
          source: LITPORT_SOURCE.name,
          reason: errorText(error),
        });
        return { source: LITPORT_SOURCE.name, proxies: [] };
      }
    })(),
    ...TEXT_SOURCES.map(async (source) => {
      try {
        const response = await axios.get<string>(source.url, commonConfig);
        return {
          source: source.name,
          proxies: extractTextProxies(String(response.data)),
        };
      } catch (error) {
        options.onSourceError?.({ source: source.name, reason: errorText(error) });
        return { source: source.name, proxies: [] };
      }
    }),
    (async () => {
      try {
        const response = await axios.get(GEONODE_SOURCE.url, {
          timeout,
          headers: { "User-Agent": DISCOVERY_USER_AGENT },
        });
        const records =
          isRecord(response.data) && Array.isArray(response.data.data)
            ? response.data.data
            : [];
        const proxies = records.flatMap((record) => {
          if (!isRecord(record)) return [];
          const ip = typeof record.ip === "string" ? record.ip : "";
          const port = String(record.port ?? "");
          const protocols = Array.isArray(record.protocols)
            ? record.protocols.map(String)
            : [];
          return protocols.includes("http") && isHostPort(`${ip}:${port}`)
            ? [`http://${ip}:${port}`]
            : [];
        });
        return { source: GEONODE_SOURCE.name, proxies };
      } catch (error) {
        options.onSourceError?.({
          source: GEONODE_SOURCE.name,
          reason: errorText(error),
        });
        return { source: GEONODE_SOURCE.name, proxies: [] };
      }
    })(),
  ];

  const results = await Promise.all(requests);
  const unique = new Map<string, string>();
  for (const result of results) {
    for (const proxy of result.proxies) {
      const endpoint = parseProxyEndpoint(proxy);
      unique.set(endpoint.label, endpoint.url);
    }
  }
  return [...unique.values()];
}

export function extractTextProxies(text: string): string[] {
  const matches =
    text.match(/(?:https?:\/\/)?(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}/gi) ?? [];
  return matches
    .map((match) => (/^https?:\/\//i.test(match) ? match : `http://${match}`))
    .filter((proxy) => {
      try {
        parseProxyEndpoint(proxy);
        return true;
      } catch {
        return false;
      }
    });
}

function isHostPort(value: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
