import { load } from "cheerio";
import { PdfValidationError, SiteStructureError } from "./errors.js";
import {
  applyFilters,
  extractFormState,
  findSearchAction,
  parsePartialResponse,
  parseResultPage,
} from "./jsf-parser.js";
import type { BinaryResponse, HttpClient, TextResponse } from "./http-client.js";
import type {
  JsfActionReference,
  ParsedPage,
  PdfReference,
  SourceProfile,
} from "./types.js";

export class JsfClient {
  private html = "";
  private pageUrl: string;
  private lastRawResponse = "";

  constructor(
    private readonly http: HttpClient,
    private readonly source: SourceProfile,
    private readonly tableSelector?: string,
  ) {
    this.pageUrl = source.url;
  }

  async open(): Promise<void> {
    const response = await this.http.getText(this.source.url);
    this.setTextResponse(response);
    // Falla temprano con un diagnóstico claro si recibimos una página ajena al sitio.
    extractFormState(this.html, this.pageUrl);
  }

  async search(filters: Record<string, string>): Promise<void> {
    const discovered = findSearchAction(this.html, this.pageUrl);
    if (!discovered) {
      if (Object.keys(filters).length > 0) {
        throw new SiteStructureError(
          "No se encontró el botón de búsqueda necesario para aplicar los filtros.",
        );
      }
      return;
    }

    const form = applyFilters(
      extractFormState(this.html, this.pageUrl),
      this.html,
      filters,
    );
    if (discovered.ajax) {
      const sourceId = discovered.reference.controlId;
      const fields = {
        ...form.fields,
        ...discovered.reference.params,
        "javax.faces.partial.ajax": "true",
        "javax.faces.source": sourceId,
        "javax.faces.partial.execute": discovered.process ?? sourceId,
        "javax.faces.partial.render": discovered.update ?? form.id,
      };
      const response = await this.http.postFormText(form.actionUrl, fields, {
        "Faces-Request": "partial/ajax",
        "X-Requested-With": "XMLHttpRequest",
      });
      await this.acceptTextResponse(response);
      return;
    }

    await this.submitStandardAction(discovered.reference, form.fields);
  }

  parsePage(pageNumber: number): ParsedPage {
    return parseResultPage(this.html, {
      source: this.source.name,
      sourceUrl: this.pageUrl,
      pageNumber,
      ...(this.tableSelector ? { tableSelector: this.tableSelector } : {}),
    });
  }

  diagnostics(): Record<string, unknown> {
    const $ = load(this.html);
    return {
      url: this.pageUrl,
      htmlLength: this.html.length,
      dataTables: $(".ui-datatable")
        .toArray()
        .map((element) => $(element).attr("id") ?? "(sin id)"),
      forms: $("form")
        .toArray()
        .map((element) => $(element).attr("id") ?? "(sin id)"),
      lastResponsePreview: this.lastRawResponse.slice(0, 2_000),
    };
  }

  async next(page: ParsedPage): Promise<void> {
    const request = page.next;
    if (!request) {
      throw new SiteStructureError("La página no contiene una acción de paginación.");
    }

    if (request.kind === "url") {
      const response = await this.http.getText(request.url, this.pageUrl);
      this.setTextResponse(response);
      return;
    }

    const form = extractFormState(this.html, this.pageUrl);
    if (request.kind === "jsf-action") {
      await this.submitStandardAction(request.action, form.fields);
      return;
    }

    const tableId = request.tableId;
    const fields = {
      ...form.fields,
      "javax.faces.partial.ajax": "true",
      "javax.faces.source": tableId,
      "javax.faces.partial.execute": tableId,
      "javax.faces.partial.render": tableId,
      [tableId]: tableId,
      [`${tableId}_pagination`]: "true",
      [`${tableId}_first`]: String(request.nextFirst),
      [`${tableId}_rows`]: String(request.rows),
      [`${tableId}_skipChildren`]: "true",
      [`${tableId}_encodeFeature`]: "true",
    };
    const response = await this.http.postFormText(form.actionUrl, fields, {
      "Faces-Request": "partial/ajax",
      "X-Requested-With": "XMLHttpRequest",
    });
    await this.acceptTextResponse(response);
  }

  async fetchPdf(reference: PdfReference): Promise<BinaryResponse> {
    let response: BinaryResponse;
    if (reference.kind === "url") {
      response = await this.http.getBinary(reference.url, this.pageUrl);
    } else {
      const form = extractFormState(this.html, this.pageUrl);
      const cleanFields = Object.fromEntries(
        Object.entries(form.fields).filter(
          ([name]) => !name.startsWith("javax.faces.partial."),
        ),
      );
      response = await this.http.postFormBinary(
        form.actionUrl,
        {
          ...cleanFields,
          ...reference.params,
          [reference.controlId]:
            reference.params[reference.controlId] ?? reference.controlId,
        },
        this.pageUrl,
      );
    }

    if (isPdf(response.body)) return response;

    const redirectUrl = extractPdfRedirect(response.body, response.url);
    if (redirectUrl) {
      const redirected = await this.http.getBinary(redirectUrl, this.pageUrl);
      if (isPdf(redirected.body)) return redirected;
      throw new PdfValidationError(
        `La URL de descarga respondió ${redirected.contentType || "contenido desconocido"}, no un PDF: ${redirected.url}`,
      );
    }

    const preview = response.body.toString("utf8", 0, 250).replace(/\s+/g, " ");
    throw new PdfValidationError(
      `La descarga no contiene la cabecera %PDF-. Tipo: ${response.contentType || "desconocido"}. Respuesta: ${preview}`,
    );
  }

  private async submitStandardAction(
    action: JsfActionReference,
    formFields?: Record<string, string>,
  ): Promise<void> {
    const form = extractFormState(this.html, this.pageUrl);
    const response = await this.http.postFormText(form.actionUrl, {
      ...(formFields ?? form.fields),
      ...action.params,
      [action.controlId]: action.params[action.controlId] ?? action.controlId,
    });
    await this.acceptTextResponse(response);
  }

  private async acceptTextResponse(response: TextResponse): Promise<void> {
    this.lastRawResponse = response.body;
    if (
      response.contentType.includes("xml") ||
      /^\s*<\?xml[^>]*>\s*<partial-response|^\s*<partial-response/i.test(
        response.body,
      )
    ) {
      const partial = parsePartialResponse(
        this.html,
        response.body,
        response.url,
      );
      this.html = partial.html;
      if (partial.redirectUrl) {
        const redirected = await this.http.getText(
          partial.redirectUrl,
          this.pageUrl,
        );
        this.setTextResponse(redirected);
      }
      return;
    }
    this.setTextResponse(response);
  }

  private setTextResponse(response: TextResponse): void {
    this.lastRawResponse = response.body;
    this.html = response.body;
    this.pageUrl = response.url;
  }
}

export function isPdf(buffer: Buffer): boolean {
  const prefix = buffer.subarray(0, Math.min(buffer.length, 1024));
  return prefix.indexOf(Buffer.from("%PDF-")) >= 0;
}

export function extractPdfRedirect(
  body: Buffer,
  responseUrl: string,
): string | undefined {
  const html = body.toString("utf8");
  const $ = load(html, { xmlMode: /<partial-response/i.test(html) });
  const redirect = $("partial-response > redirect").attr("url");
  if (redirect) return new URL(redirect, responseUrl).toString();

  const candidates = [
    $("iframe[src]").attr("src"),
    $("embed[src]").attr("src"),
    $("object[data]").attr("data"),
    $("a[href]")
      .toArray()
      .map((element) => $(element).attr("href"))
      .find((href) => href && /\.pdf(?:$|[?#])|download|descarga/i.test(href)),
  ].filter((value): value is string => Boolean(value));
  if (candidates[0]) return new URL(candidates[0], responseUrl).toString();

  const refresh = $("meta[http-equiv]")
    .filter((_, element) =>
      /^refresh$/i.test($(element).attr("http-equiv") ?? ""),
    )
    .attr("content");
  const refreshUrl = refresh?.match(/url\s*=\s*["']?([^"';]+)/i)?.[1];
  if (refreshUrl) return new URL(refreshUrl, responseUrl).toString();
  return undefined;
}
