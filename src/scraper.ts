import { PdfDownloader } from "./downloader.js";
import { HttpStatusError, VpnRequiredError } from "./errors.js";
import { HttpClient } from "./http-client.js";
import { JsfClient } from "./jsf-client.js";
import { Logger } from "./logger.js";
import { DocumentStore, FailureStore } from "./storage.js";
import type { FailureRecord, ScraperConfig } from "./types.js";
import { errorMessage } from "./utils.js";

export interface ScrapeSummary {
  pagesVisited: number;
  documentsSeen: number;
  documentsSaved: number;
  pdfsDownloaded: number;
  pdfsFailed: number;
  stoppedReason: string;
}

export class Scraper {
  private readonly http: HttpClient;
  private readonly jsf: JsfClient;
  private readonly documents: DocumentStore;
  private readonly failures: FailureStore;
  private readonly downloader: PdfDownloader;

  constructor(
    private readonly config: ScraperConfig,
    private readonly logger: Logger,
  ) {
    this.http = new HttpClient({
      timeoutMs: config.requestTimeoutMs,
      minDelayMs: config.requestDelayMs,
      maxRetries: config.maxRetries,
      backoffBaseMs: config.backoffBaseMs,
      onRetry: (event) =>
        this.logger.warn("Solicitud reintentable", {
          url: event.url,
          intento: `${event.attempt}/${event.maxAttempts}`,
          esperaMs: event.delayMs,
          ...(event.status ? { status: event.status } : {}),
          razon: event.reason,
        }),
    });
    this.jsf = new JsfClient(
      this.http,
      config.source,
      config.tableSelector ?? config.source.tableSelector,
    );
    this.documents = new DocumentStore(config.outputDir);
    this.failures = new FailureStore(config.outputDir);
    this.downloader = new PdfDownloader(config.outputDir, this.jsf);
  }

  async run(): Promise<ScrapeSummary> {
    await Promise.all([
      this.documents.initialize(),
      this.failures.initialize(),
      this.downloader.initialize(),
    ]);
    if (this.config.retryFailedOnly && this.failures.size === 0) {
      return emptySummary("No hay descargas fallidas pendientes.");
    }

    this.logger.info("Iniciando scraper", {
      fuente: this.config.source.label,
      url: this.config.source.url,
      salida: this.config.outputDir,
      descargarPdfs: this.config.downloadPdfs,
      soloFallidos: this.config.retryFailedOnly,
    });

    try {
      await this.jsf.open();
    } catch (error) {
      if (
        this.config.source.requiresPeruVpn &&
        error instanceof HttpStatusError &&
        [401, 403, 451].includes(error.status)
      ) {
        throw new VpnRequiredError(error.url, error.status);
      }
      throw error;
    }
    await this.jsf.search(this.config.filters);
    this.logger.debug(
      "Estado JSF después de buscar",
      this.jsf.diagnostics(),
    );

    const retryIds = this.config.retryFailedOnly
      ? this.failures.ids()
      : undefined;
    const fingerprints = new Set<string>();
    let pagesVisited = 0;
    let documentsSeen = 0;
    let documentsSaved = 0;
    let pdfsDownloaded = 0;
    let pdfsFailed = 0;
    let stoppedReason = "Se alcanzó la última página.";

    for (let requestedPage = 1; ; requestedPage += 1) {
      if (
        this.config.maxPages !== undefined &&
        pagesVisited >= this.config.maxPages
      ) {
        stoppedReason = `Se alcanzó --max-pages=${this.config.maxPages}.`;
        break;
      }

      const page = this.jsf.parsePage(requestedPage);
      pagesVisited += 1;
      this.logger.info("Página procesada", {
        pagina: page.currentPage,
        totalPaginas: page.totalPages ?? "desconocido",
        registros: page.records.length,
        totalRegistros: page.totalRecords ?? "desconocido",
      });

      if (fingerprints.has(page.fingerprint) && page.records.length > 0) {
        stoppedReason =
          "La paginación devolvió una página repetida; se detuvo para evitar un bucle.";
        this.logger.warn(stoppedReason, { pagina: page.currentPage });
        break;
      }
      fingerprints.add(page.fingerprint);

      for (const record of page.records) {
        if (
          this.config.maxDocuments !== undefined &&
          documentsSeen >= this.config.maxDocuments
        ) {
          stoppedReason = `Se alcanzó --max-documents=${this.config.maxDocuments}.`;
          break;
        }
        documentsSeen += 1;
        if (await this.documents.append(record)) documentsSaved += 1;

        const selectedForDownload =
          this.config.downloadPdfs &&
          Boolean(record.pdf) &&
          (retryIds === undefined || retryIds.has(record.id));
        if (!selectedForDownload) continue;

        try {
          const result = await this.downloader.download(record);
          await this.documents.recordDownload(record.id, result);
          await this.failures.remove(record.id);
          retryIds?.delete(record.id);
          pdfsDownloaded += 1;
          this.logger.info("PDF guardado", {
            documento: record.id,
            bytes: result.bytes,
            archivo: result.path,
          });
        } catch (error) {
          pdfsFailed += 1;
          const status =
            error instanceof HttpStatusError ? error.status : undefined;
          const failure: FailureRecord = {
            documentId: record.id,
            title: record.title,
            source: record.source,
            sourceUrl: record.sourceUrl,
            page: record.page,
            ...(record.pdf ? { pdf: record.pdf } : {}),
            attempts: this.config.maxRetries + 1,
            reason: errorMessage(error),
            ...(status !== undefined ? { status } : {}),
            lastTriedAt: new Date().toISOString(),
          };
          await this.failures.put(failure);
          this.logger.error("Falló la descarga; se agregó a la cola", {
            documento: record.id,
            ...(status !== undefined ? { status } : {}),
            razon: failure.reason,
          });
        }
      }

      if (
        this.config.maxDocuments !== undefined &&
        documentsSeen >= this.config.maxDocuments
      ) {
        break;
      }
      if (retryIds !== undefined && retryIds.size === 0) {
        stoppedReason = "Se recuperaron todos los fallos pendientes.";
        break;
      }
      if (!page.hasNext || !page.next) break;
      await this.jsf.next(page);
      this.logger.debug("Estado JSF después de paginar", this.jsf.diagnostics());
    }

    return {
      pagesVisited,
      documentsSeen,
      documentsSaved,
      pdfsDownloaded,
      pdfsFailed,
      stoppedReason,
    };
  }
}

function emptySummary(reason: string): ScrapeSummary {
  return {
    pagesVisited: 0,
    documentsSeen: 0,
    documentsSaved: 0,
    pdfsDownloaded: 0,
    pdfsFailed: 0,
    stoppedReason: reason,
  };
}
