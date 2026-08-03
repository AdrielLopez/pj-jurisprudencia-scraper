import { open, mkdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { JsfClient } from "./jsf-client.js";
import { isPdf } from "./jsf-client.js";
import type { DocumentRecord, DownloadResult } from "./types.js";
import { safeFilename } from "./utils.js";

export class PdfDownloader {
  private readonly pdfDir: string;

  constructor(
    outputDir: string,
    private readonly jsf: JsfClient,
  ) {
    this.pdfDir = path.join(outputDir, "pdfs");
  }

  async initialize(): Promise<void> {
    await mkdir(this.pdfDir, { recursive: true });
  }

  async download(record: DocumentRecord): Promise<DownloadResult> {
    if (!record.pdf) throw new Error("El documento no tiene una referencia PDF");
    const filename = `${safeFilename(record.title, 120)}-${record.id.slice(0, 10)}.pdf`;
    const destination = path.join(this.pdfDir, filename);
    const existing = await inspectExistingPdf(destination);
    if (existing !== undefined) {
      return {
        path: destination,
        bytes: existing,
        downloadedAt: new Date().toISOString(),
        resolvedUrl:
          record.pdf.kind === "url" ? record.pdf.url : record.sourceUrl,
      };
    }

    const response = await this.jsf.fetchPdf(record.pdf);
    const temporary = `${destination}.${process.pid}.part`;
    await writeFile(temporary, response.body);
    await rename(temporary, destination);
    return {
      path: destination,
      bytes: response.body.length,
      downloadedAt: new Date().toISOString(),
      resolvedUrl: response.url,
    };
  }
}

async function inspectExistingPdf(filePath: string): Promise<number | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(filePath, "r");
    const prefix = Buffer.alloc(1024);
    const { bytesRead } = await handle.read(prefix, 0, prefix.length, 0);
    const metadata = await stat(filePath);
    if (isPdf(prefix.subarray(0, bytesRead))) return metadata.size;
    await handle.close();
    handle = undefined;
    await rename(filePath, `${filePath}.invalid-${Date.now()}`);
    return undefined;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  } finally {
    await handle?.close();
  }
}
