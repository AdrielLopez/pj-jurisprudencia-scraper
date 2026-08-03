import { mkdir, readFile, rename, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import type {
  DocumentRecord,
  DownloadResult,
  FailureRecord,
} from "./types.js";

export class DocumentStore {
  private readonly ids = new Set<string>();
  private readonly documentsPath: string;
  private readonly downloadsPath: string;

  constructor(private readonly outputDir: string) {
    this.documentsPath = path.join(outputDir, "data", "documents.jsonl");
    this.downloadsPath = path.join(outputDir, "data", "downloads.jsonl");
  }

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.documentsPath), { recursive: true });
    try {
      const existing = await readFile(this.documentsPath, "utf8");
      for (const line of existing.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const record = JSON.parse(line) as Pick<DocumentRecord, "id">;
          if (record.id) this.ids.add(record.id);
        } catch {
          // Una línea truncada no impide continuar; el nuevo contenido sigue en JSONL.
        }
      }
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }

  has(documentId: string): boolean {
    return this.ids.has(documentId);
  }

  async append(record: DocumentRecord): Promise<boolean> {
    if (this.ids.has(record.id)) return false;
    await appendFile(this.documentsPath, `${JSON.stringify(record)}\n`, "utf8");
    this.ids.add(record.id);
    return true;
  }

  async recordDownload(
    documentId: string,
    result: DownloadResult,
  ): Promise<void> {
    await appendFile(
      this.downloadsPath,
      `${JSON.stringify({ documentId, ...result })}\n`,
      "utf8",
    );
  }
}

export class FailureStore {
  private readonly failures = new Map<string, FailureRecord>();
  private readonly filePath: string;

  constructor(outputDir: string) {
    this.filePath = path.join(outputDir, "data", "failures.json");
  }

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const parsed = JSON.parse(
        await readFile(this.filePath, "utf8"),
      ) as FailureRecord[];
      for (const failure of parsed) {
        if (failure.documentId) this.failures.set(failure.documentId, failure);
      }
    } catch (error) {
      if (isMissingFile(error)) return;
      if (error instanceof SyntaxError) {
        throw new Error(
          `El archivo de fallos no contiene JSON válido: ${this.filePath}`,
          { cause: error },
        );
      }
      throw error;
    }
  }

  get size(): number {
    return this.failures.size;
  }

  has(documentId: string): boolean {
    return this.failures.has(documentId);
  }

  ids(): Set<string> {
    return new Set(this.failures.keys());
  }

  async put(failure: FailureRecord): Promise<void> {
    this.failures.set(failure.documentId, failure);
    await this.persist();
  }

  async remove(documentId: string): Promise<void> {
    if (!this.failures.delete(documentId)) return;
    await this.persist();
  }

  private async persist(): Promise<void> {
    const temporary = `${this.filePath}.tmp`;
    const values = [...this.failures.values()].sort((a, b) =>
      a.documentId.localeCompare(b.documentId),
    );
    await writeFile(temporary, `${JSON.stringify(values, null, 2)}\n`, "utf8");
    await rename(temporary, this.filePath);
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
