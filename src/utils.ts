import { createHash } from "node:crypto";
import path from "node:path";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeKey(value: string): string {
  return normalizeSpace(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function stableId(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 24);
}

export function safeFilename(value: string, maxLength = 150): string {
  const cleaned = normalizeSpace(value)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .replace(/-+/g, "-")
    .trim();
  const base = cleaned || "documento";
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  const safe = reserved.test(base) ? `_${base}` : base;
  return safe.slice(0, maxLength).replace(/[. ]+$/g, "") || "documento";
}

export function resolveOutputPath(root: string, ...parts: string[]): string {
  return path.resolve(root, ...parts);
}

export function parsePositiveInteger(
  name: string,
  raw: string | undefined,
): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} debe ser un entero mayor que cero`);
  }
  return parsed;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
