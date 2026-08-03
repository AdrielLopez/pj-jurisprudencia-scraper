export type SourceName = "pj" | "oefa" | "custom";

export interface SourceProfile {
  name: SourceName;
  label: string;
  url: string;
  requiresPeruVpn: boolean;
  tableSelector?: string;
}

export interface ScraperConfig {
  source: SourceProfile;
  outputDir: string;
  downloadPdfs: boolean;
  retryFailedOnly: boolean;
  maxPages?: number;
  maxDocuments?: number;
  requestDelayMs: number;
  requestTimeoutMs: number;
  maxRetries: number;
  backoffBaseMs: number;
  filters: Record<string, string>;
  tableSelector?: string;
  proxyUrl?: string;
  freePeruProxy: boolean;
  proxyUrls?: string[];
}

export interface FormState {
  id: string;
  actionUrl: string;
  fields: Record<string, string>;
}

export interface JsfActionReference {
  kind: "jsf-action";
  formId: string;
  controlId: string;
  params: Record<string, string>;
}

export interface UrlReference {
  kind: "url";
  url: string;
}

export type PdfReference = JsfActionReference | UrlReference;

export interface DocumentRecord {
  id: string;
  source: SourceName;
  sourceUrl: string;
  page: number;
  ordinal: number;
  title: string;
  fields: Record<string, string>;
  pdf?: PdfReference;
  detailUrl?: string;
  scrapedAt: string;
}

export interface PrimeFacesPagination {
  kind: "primefaces";
  tableId: string;
  nextFirst: number;
  rows: number;
}

export interface ControlPagination {
  kind: "jsf-action";
  action: JsfActionReference;
}

export interface UrlPagination {
  kind: "url";
  url: string;
}

export type PaginationRequest =
  | PrimeFacesPagination
  | ControlPagination
  | UrlPagination;

export interface ParsedPage {
  records: DocumentRecord[];
  currentPage: number;
  totalPages?: number;
  totalRecords?: number;
  rowsPerPage: number;
  hasNext: boolean;
  next?: PaginationRequest;
  fingerprint: string;
}

export interface DownloadResult {
  path: string;
  bytes: number;
  downloadedAt: string;
  resolvedUrl: string;
}

export interface FailureRecord {
  documentId: string;
  title: string;
  source: SourceName;
  sourceUrl: string;
  page: number;
  pdf?: PdfReference;
  attempts: number;
  reason: string;
  status?: number;
  lastTriedAt: string;
}

export interface RequestRetryEvent {
  url: string;
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  status?: number;
  reason: string;
  proxy?: string;
}
