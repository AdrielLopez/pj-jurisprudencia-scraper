import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";
import { HttpCookieAgent, HttpsCookieAgent } from "http-cookie-agent/http";
import { CookieJar } from "tough-cookie";
import { HttpStatusError } from "./errors.js";
import type { RequestRetryEvent } from "./types.js";
import { errorMessage, sleep as defaultSleep } from "./utils.js";

export interface HttpClientOptions {
  timeoutMs: number;
  minDelayMs: number;
  maxRetries: number;
  backoffBaseMs: number;
  userAgent?: string;
  onRetry?: (event: RequestRetryEvent) => void;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface TextResponse {
  body: string;
  status: number;
  url: string;
  contentType: string;
}

export interface BinaryResponse {
  body: Buffer;
  status: number;
  url: string;
  contentType: string;
  contentDisposition?: string;
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (compatible; OEFA-Resoluciones-Scraper/1.0; +https://github.com/)";

export class HttpClient {
  private readonly client: AxiosInstance;
  private readonly sleeper: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private lastRequestAt = 0;

  constructor(private readonly options: HttpClientOptions) {
    const jar = new CookieJar();
    this.client = axios.create({
      httpAgent: new HttpCookieAgent(
        {
          cookies: { jar },
          keepAlive: true,
        } as unknown as ConstructorParameters<typeof HttpCookieAgent>[0],
      ),
      httpsAgent: new HttpsCookieAgent(
        {
          cookies: { jar },
          keepAlive: true,
        } as unknown as ConstructorParameters<typeof HttpsCookieAgent>[0],
      ),
      timeout: options.timeoutMs,
      maxRedirects: 8,
      decompress: true,
      validateStatus: () => true,
      headers: {
        "User-Agent": options.userAgent ?? DEFAULT_USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf;q=0.8,*/*;q=0.7",
        "Accept-Language": "es-PE,es;q=0.9,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        Connection: "keep-alive",
      },
    });
    this.sleeper = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
  }

  async getText(url: string, referer?: string): Promise<TextResponse> {
    const response = await this.request<string>({
      method: "GET",
      url,
      responseType: "text",
      headers: referer ? { Referer: referer } : undefined,
    });
    return this.toTextResponse(response, url);
  }

  async postFormText(
    url: string,
    fields: Record<string, string>,
    headers: Record<string, string> = {},
  ): Promise<TextResponse> {
    const response = await this.request<string>({
      method: "POST",
      url,
      data: new URLSearchParams(fields).toString(),
      responseType: "text",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: new URL(url).origin,
        Referer: url,
        ...headers,
      },
    });
    return this.toTextResponse(response, url);
  }

  async getBinary(url: string, referer?: string): Promise<BinaryResponse> {
    const response = await this.request<ArrayBuffer>({
      method: "GET",
      url,
      responseType: "arraybuffer",
      headers: referer ? { Referer: referer } : undefined,
    });
    return this.toBinaryResponse(response, url);
  }

  async postFormBinary(
    url: string,
    fields: Record<string, string>,
    referer?: string,
  ): Promise<BinaryResponse> {
    const response = await this.request<ArrayBuffer>({
      method: "POST",
      url,
      data: new URLSearchParams(fields).toString(),
      responseType: "arraybuffer",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: new URL(url).origin,
        Referer: referer ?? url,
      },
    });
    return this.toBinaryResponse(response, url);
  }

  private async request<T>(
    requestConfig: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    const maxAttempts = this.options.maxRetries + 1;
    const url = String(requestConfig.url);
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await this.waitForRateLimit();
      try {
        const response = await this.client.request<T>({
          ...requestConfig,
          signal: AbortSignal.timeout(this.options.timeoutMs),
        });
        if (response.status >= 200 && response.status < 400) {
          return response;
        }

        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt === maxAttempts) {
          throw new HttpStatusError(
            `HTTP ${response.status} al solicitar ${url}`,
            response.status,
            url,
            this.bodyPreview(response.data),
          );
        }

        const delayMs = this.retryDelayMs(
          attempt,
          this.header(response, "retry-after"),
        );
        this.options.onRetry?.({
          url,
          attempt,
          maxAttempts,
          delayMs,
          status: response.status,
          reason:
            response.status === 429
              ? "Too Many Requests"
              : `HTTP ${response.status}`,
        });
        await this.sleeper(delayMs);
        continue;
      } catch (error) {
        if (error instanceof HttpStatusError) throw error;
        lastError = error;
        if (attempt === maxAttempts) break;

        const delayMs = this.retryDelayMs(attempt);
        this.options.onRetry?.({
          url,
          attempt,
          maxAttempts,
          delayMs,
          reason: errorMessage(error),
        });
        await this.sleeper(delayMs);
      }
    }

    throw new Error(
      `La solicitud a ${url} falló después de ${maxAttempts} intentos: ${errorMessage(lastError)}`,
      { cause: lastError },
    );
  }

  private async waitForRateLimit(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    const remaining = this.options.minDelayMs - elapsed;
    if (remaining > 0) await this.sleeper(remaining);
    this.lastRequestAt = Date.now();
  }

  private retryDelayMs(attempt: number, retryAfter?: string): number {
    const retryAfterMs = parseRetryAfter(retryAfter);
    const exponential = this.options.backoffBaseMs * 2 ** (attempt - 1);
    const jitter = Math.floor(this.random() * Math.max(1, exponential * 0.2));
    return Math.max(retryAfterMs ?? 0, exponential + jitter);
  }

  private header(response: AxiosResponse, name: string): string | undefined {
    const value = response.headers[name];
    if (value === undefined || value === null) return undefined;
    return Array.isArray(value) ? String(value[0]) : String(value);
  }

  private responseUrl(response: AxiosResponse, fallback: string): string {
    const request = response.request as
      | { res?: { responseUrl?: string }; _redirectable?: { _currentUrl?: string } }
      | undefined;
    return (
      request?.res?.responseUrl ??
      request?._redirectable?._currentUrl ??
      response.config.url ??
      fallback
    );
  }

  private toTextResponse(
    response: AxiosResponse<string>,
    fallbackUrl: string,
  ): TextResponse {
    const raw = response.data;
    const body = typeof raw === "string" ? raw : String(raw);
    return {
      body,
      status: response.status,
      url: this.responseUrl(response, fallbackUrl),
      contentType: this.header(response, "content-type") ?? "",
    };
  }

  private toBinaryResponse(
    response: AxiosResponse<ArrayBuffer>,
    fallbackUrl: string,
  ): BinaryResponse {
    const contentDisposition = this.header(response, "content-disposition");
    return {
      body: Buffer.from(response.data),
      status: response.status,
      url: this.responseUrl(response, fallbackUrl),
      contentType: this.header(response, "content-type") ?? "",
      ...(contentDisposition ? { contentDisposition } : {}),
    };
  }

  private bodyPreview(body: unknown): string | undefined {
    if (body === undefined || body === null) return undefined;
    if (typeof body === "string") return body.slice(0, 500);
    if (body instanceof ArrayBuffer) {
      return Buffer.from(body).toString("utf8", 0, 500);
    }
    return String(body).slice(0, 500);
  }
}

export function parseRetryAfter(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, timestamp - Date.now());
}
