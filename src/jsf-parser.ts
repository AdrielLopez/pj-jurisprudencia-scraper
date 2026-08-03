import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import { SiteStructureError } from "./errors.js";
import type {
  DocumentRecord,
  FormState,
  JsfActionReference,
  ParsedPage,
  PdfReference,
  SourceName,
} from "./types.js";
import { normalizeKey, normalizeSpace, stableId } from "./utils.js";

type Selection = Cheerio<AnyNode>;

export interface SearchAction {
  reference: JsfActionReference;
  ajax: boolean;
  process?: string;
  update?: string;
}

export interface ParsePageOptions {
  source: SourceName;
  sourceUrl: string;
  pageNumber: number;
  tableSelector?: string;
}

export interface PartialResponse {
  html: string;
  redirectUrl?: string;
  viewState?: string;
}

const SEARCH_PATTERN = /\b(buscar|consultar|search|filtrar)\b/i;
const PDF_PATTERN = /\b(pdf|archivo|documento|descarga|descargar|ver resoluci[oó]n)\b/i;
const DETAIL_PATTERN = /\b(detalle|ficha|ver m[aá]s|informaci[oó]n)\b/i;

export function extractFormState(html: string, pageUrl: string): FormState {
  const $ = load(html);
  const forms = $("form").toArray();
  if (forms.length === 0) {
    throw new SiteStructureError(
      "No se encontró ningún formulario JSF en la respuesta.",
    );
  }

  let selected = forms[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const form of forms) {
    const $form = $(form);
    const score =
      ($form.find('[name="javax.faces.ViewState"]').length > 0 ? 20 : 0) +
      ($form.find(".ui-datatable, table[role=grid]").length > 0 ? 10 : 0) +
      ($form.find("button, input[type=submit]").filter((_, element) => {
        const control = $(element);
        return SEARCH_PATTERN.test(
          normalizeSpace(`${control.text()} ${control.attr("value") ?? ""}`),
        );
      }).length > 0
        ? 8
        : 0) +
      $form.find("input[type=hidden]").length;
    if (score > bestScore) {
      bestScore = score;
      selected = form;
    }
  }

  const $form = $(selected);
  const id = $form.attr("id") ?? $form.attr("name") ?? "form";
  const action = $form.attr("action") || pageUrl;
  const fields: Record<string, string> = {};

  $form.find("input, select, textarea").each((_, element) => {
    const control = $(element);
    const name = control.attr("name");
    if (!name || control.attr("disabled") !== undefined) return;
    const tag = element.tagName.toLowerCase();
    const type = (control.attr("type") ?? "").toLowerCase();
    if (["submit", "button", "reset", "file", "image"].includes(type)) return;
    if (["checkbox", "radio"].includes(type) && control.attr("checked") === undefined) {
      return;
    }

    if (tag === "select") {
      const selectedOption = control.find("option[selected]").first();
      const fallbackOption = control.find("option").first();
      fields[name] =
        selectedOption.attr("value") ?? fallbackOption.attr("value") ?? "";
      return;
    }
    fields[name] = control.attr("value") ?? control.text() ?? "";
  });

  if (!fields[id]) fields[id] = id;
  return {
    id,
    actionUrl: new URL(action, pageUrl).toString(),
    fields,
  };
}

export function findSearchAction(
  html: string,
  pageUrl: string,
): SearchAction | undefined {
  const $ = load(html);
  const form = extractFormState(html, pageUrl);
  const $form = $(`[id="${escapeAttribute(form.id)}"], form[name="${escapeAttribute(form.id)}"]`).first();
  const controls = $form
    .find("button, input[type=submit], input[type=image], a[onclick]")
    .toArray();

  let selected: (typeof controls)[number] | undefined;
  let bestScore = 0;
  for (const element of controls) {
    const control = $(element);
    const text = normalizeSpace(
      `${control.text()} ${control.attr("value") ?? ""} ${control.attr("title") ?? ""} ${control.attr("aria-label") ?? ""}`,
    );
    const onclick = control.attr("onclick") ?? "";
    const score =
      (SEARCH_PATTERN.test(text) ? 20 : 0) +
      (SEARCH_PATTERN.test(control.attr("id") ?? "") ? 8 : 0) +
      (/PrimeFaces\.ab/.test(onclick) ? 4 : 0);
    if (score > bestScore) {
      selected = element;
      bestScore = score;
    }
  }
  if (!selected) return undefined;

  const control = $(selected);
  const onclick = control.attr("onclick") ?? "";
  const submitParams = parseSubmitParams(onclick);
  const controlId =
    primeFacesOption(onclick, "s") ??
    control.attr("name") ??
    control.attr("id") ??
    primarySubmitControl(submitParams) ??
    "";
  if (!controlId) return undefined;

  return {
    reference: {
      kind: "jsf-action",
      formId: form.id,
      controlId,
      params: {
        ...submitParams,
        [controlId]: control.attr("value") || controlId,
      },
    },
    ajax: /PrimeFaces\.ab\s*\(/.test(onclick),
    ...(primeFacesOption(onclick, "p")
      ? { process: primeFacesOption(onclick, "p") }
      : {}),
    ...(primeFacesOption(onclick, "u")
      ? { update: primeFacesOption(onclick, "u") }
      : {}),
  };
}

export function applyFilters(
  form: FormState,
  html: string,
  filters: Record<string, string>,
): FormState {
  if (Object.keys(filters).length === 0) return form;
  const $ = load(html);
  const labels = new Map<string, string>();
  $("label[for]").each((_, element) => {
    const label = $(element);
    const target = label.attr("for");
    if (target) labels.set(normalizeKey(label.text()), target);
  });

  const fields = { ...form.fields };
  for (const [requestedKey, value] of Object.entries(filters)) {
    const normalizedRequested = normalizeKey(requestedKey);
    const exactName = Object.keys(fields).find((name) => name === requestedKey);
    const suffixName = Object.keys(fields).find(
      (name) => normalizeKey(name.split(":").pop() ?? name) === normalizedRequested,
    );
    const labelTarget = labels.get(normalizedRequested);
    const labelName = labelTarget
      ? Object.keys(fields).find(
          (name) => name === labelTarget || name.endsWith(`:${labelTarget}`),
        )
      : undefined;
    const target = exactName ?? suffixName ?? labelName;
    if (!target) {
      throw new SiteStructureError(
        `No se encontró un control para el filtro "${requestedKey}". Usa el atributo name exacto del formulario JSF.`,
      );
    }
    fields[target] = value;
  }
  return { ...form, fields };
}

export function parseResultPage(
  html: string,
  options: ParsePageOptions,
): ParsedPage {
  const $ = load(html);
  const root = chooseResultRoot($, options.tableSelector);
  if (!root) {
    const responsePreview = normalizeSpace($("body").text()).slice(0, 300);
    throw new SiteStructureError(
      `No se encontró una tabla de resultados. Revisa la VPN, los filtros o usa --table-selector.${responsePreview ? ` Respuesta: ${responsePreview}` : ""}`,
    );
  }

  const headers = extractHeaders($, root);
  const rows = extractRows($, root);
  const form = extractFormState(html, options.sourceUrl);
  const records: DocumentRecord[] = [];

  rows.each((rowIndex, rowElement) => {
    const row = $(rowElement);
    if (row.hasClass("ui-datatable-empty-message")) return;
    const cells = row.children("td");
    if (cells.length === 0) return;
    const values = cells
      .toArray()
      .map((cell) => normalizeSpace($(cell).text()));
    if (values.every((value) => value === "")) return;

    const fields: Record<string, string> = {};
    values.forEach((value, index) => {
      const header = uniqueHeader(headers[index] ?? `columna_${index + 1}`, fields);
      fields[header] = value;
    });

    const identityFields = Object.fromEntries(
      Object.entries(fields).filter(
        ([key]) => !/^(nro|numero|#|orden|item)$/i.test(normalizeKey(key)),
      ),
    );
    const title = deriveTitle(fields);
    const id = stableId({ source: options.source, fields: identityFields });
    const pdf = extractPdfReference($, row, headers, form, options.sourceUrl);
    const detailUrl = extractDetailUrl($, row, options.sourceUrl);

    records.push({
      id,
      source: options.source,
      sourceUrl: options.sourceUrl,
      page: options.pageNumber,
      ordinal: rowIndex + 1,
      title,
      fields,
      ...(pdf ? { pdf } : {}),
      ...(detailUrl ? { detailUrl } : {}),
      scrapedAt: new Date().toISOString(),
    });
  });

  const pagination = extractPagination(
    $,
    root,
    form,
    options.sourceUrl,
    options.pageNumber,
    Math.max(1, records.length),
  );

  return {
    records,
    currentPage: pagination.currentPage,
    ...(pagination.totalPages !== undefined
      ? { totalPages: pagination.totalPages }
      : {}),
    ...(pagination.totalRecords !== undefined
      ? { totalRecords: pagination.totalRecords }
      : {}),
    rowsPerPage: pagination.rows,
    hasNext: pagination.hasNext,
    ...(pagination.next ? { next: pagination.next } : {}),
    fingerprint: stableId(records.map((record) => record.id)),
  };
}

export function parsePartialResponse(
  baseHtml: string,
  xml: string,
  responseUrl: string,
): PartialResponse {
  const $xml = load(xml, { xmlMode: true });
  const redirect = $xml("partial-response > redirect").attr("url");
  const $base = load(baseHtml);
  let viewState: string | undefined;

  $xml("partial-response > changes > update").each((_, element) => {
    const update = $xml(element);
    const id = update.attr("id");
    const content = update.text();
    if (!id) return;
    if (id.includes("javax.faces.ViewState")) {
      viewState = content;
      $base('[name="javax.faces.ViewState"]').attr("value", content);
      return;
    }

    const current = $base(`[id="${escapeAttribute(id)}"]`);
    if (
      current.length > 0 &&
      current.hasClass("ui-datatable") &&
      /^\s*<tr[\s>]/i.test(content)
    ) {
      // PrimeFaces 6 usa el id del DataTable para actualizar únicamente sus
      // filas. Reemplazar el <div> completo eliminaría cabeceras y paginador.
      const dataBody = current
        .find("tbody[id$='_data'], tbody.ui-datatable-data")
        .first();
      if (dataBody.length > 0) dataBody.html(content);
      else current.append(`<table><tbody class="ui-datatable-data">${content}</tbody></table>`);
    } else if (current.length > 0) {
      current.replaceWith(content);
    } else {
      $base("body").append(content);
    }
  });

  return {
    html: $base.html(),
    ...(redirect ? { redirectUrl: new URL(redirect, responseUrl).toString() } : {}),
    ...(viewState ? { viewState } : {}),
  };
}

function chooseResultRoot(
  $: CheerioAPI,
  selector?: string,
): Selection | undefined {
  let candidates: AnyNode[] = [];
  try {
    candidates = selector
      ? $(selector).toArray()
      : $(".ui-datatable, table[role=grid], table").toArray();
  } catch (error) {
    throw new SiteStructureError(
      `El selector de tabla no es válido: ${String(error)}`,
    );
  }

  let selected: (typeof candidates)[number] | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const root = $(candidate);
    const headerText = normalizeSpace(root.find("thead, th").text());
    const rowCount = root.find("tbody tr").length;
    const keywordCount = [
      /expediente/i,
      /resoluci[oó]n/i,
      /archivo|pdf|documento/i,
      /materia|sumilla|ponente|sala/i,
    ].filter((pattern) => pattern.test(headerText)).length;
    const score =
      keywordCount * 30 +
      Math.min(rowCount, 20) +
      (root.hasClass("ui-datatable") ? 15 : 0) +
      (root.find("tbody[id$='_data'], tbody.ui-datatable-data").length > 0
        ? 12
        : 0) -
      (root.parents(".ui-datatable").length > 0 ? 8 : 0);
    if (score > bestScore) {
      selected = candidate;
      bestScore = score;
    }
  }
  return selected ? $(selected) : undefined;
}

function extractHeaders($: CheerioAPI, root: Selection): string[] {
  const headerRows = root.find("thead tr").toArray();
  let selected: (typeof headerRows)[number] | undefined;
  let maxCells = -1;
  for (const row of headerRows) {
    const count = $(row).children("th, td").length;
    if (count > maxCells) {
      maxCells = count;
      selected = row;
    }
  }
  if (!selected) return [];
  return $(selected)
    .children("th, td")
    .toArray()
    .map((cell, index) => {
      const header = $(cell);
      return (
        normalizeSpace(
          header.attr("aria-label") ?? header.attr("data-headertext") ?? header.text(),
        ) || `columna_${index + 1}`
      );
    });
}

function extractRows($: CheerioAPI, root: Selection): Selection {
  const bodyCandidates = root
    .find("tbody[id$='_data'], tbody.ui-datatable-data, tbody")
    .toArray();
  let selected: (typeof bodyCandidates)[number] | undefined;
  let bestCount = -1;
  for (const body of bodyCandidates) {
    const count = $(body)
      .children("tr")
      .filter((_, row) => $(row).children("td").length > 0).length;
    if (count > bestCount) {
      selected = body;
      bestCount = count;
    }
  }
  return selected ? $(selected).children("tr") : root.find("tbody > tr");
}

function extractPdfReference(
  $: CheerioAPI,
  row: Selection,
  headers: string[],
  form: FormState,
  baseUrl: string,
): PdfReference | undefined {
  const cells = row.children("td").toArray();
  const likelyCells = cells.filter((_, index) =>
    PDF_PATTERN.test(headers[index] ?? ""),
  );
  const scopes = likelyCells.length > 0 ? likelyCells.map((cell) => $(cell)) : [row];

  for (const scope of scopes) {
    const elements = scope.find("a, button, input, iframe, embed, object").toArray();
    for (const element of elements) {
      const control = $(element);
      const label = normalizeSpace(
        `${control.text()} ${control.attr("title") ?? ""} ${control.attr("aria-label") ?? ""} ${control.attr("alt") ?? ""}`,
      );
      const candidates = [
        control.attr("href"),
        control.attr("src"),
        control.attr("data"),
      ].filter((value): value is string => Boolean(value));
      const onclick = control.attr("onclick") ?? "";
      const onclickUrl = extractUrlFromJavascript(onclick);
      if (onclickUrl) candidates.unshift(onclickUrl);

      for (const candidate of candidates) {
        if (/^(#|javascript:|data:)/i.test(candidate)) continue;
        if (
          /\.pdf(?:$|[?#])/i.test(candidate) ||
          /download|descarga|archivo|documento|verpdf/i.test(candidate) ||
          PDF_PATTERN.test(label) ||
          likelyCells.length > 0
        ) {
          return { kind: "url", url: new URL(candidate, baseUrl).toString() };
        }
      }

      const submitParams = parseSubmitParams(onclick);
      const controlId =
        primeFacesOption(onclick, "s") ??
        control.attr("name") ??
        control.attr("id") ??
        primarySubmitControl(submitParams);
      if (
        controlId &&
        (PDF_PATTERN.test(label) || likelyCells.length > 0 || /download/i.test(onclick))
      ) {
        return {
          kind: "jsf-action",
          formId: form.id,
          controlId,
          params: {
            ...submitParams,
            [controlId]: control.attr("value") || controlId,
          },
        };
      }
    }
  }
  return undefined;
}

function extractDetailUrl(
  $: CheerioAPI,
  row: Selection,
  baseUrl: string,
): string | undefined {
  for (const element of row.find("a[href]").toArray()) {
    const link = $(element);
    const href = link.attr("href");
    const text = normalizeSpace(
      `${link.text()} ${link.attr("title") ?? ""} ${link.attr("aria-label") ?? ""}`,
    );
    if (
      href &&
      !/^(#|javascript:)/i.test(href) &&
      !/\.pdf(?:$|[?#])/i.test(href) &&
      DETAIL_PATTERN.test(text)
    ) {
      return new URL(href, baseUrl).toString();
    }
  }
  return undefined;
}

function extractPagination(
  $: CheerioAPI,
  root: Selection,
  form: FormState,
  baseUrl: string,
  fallbackCurrentPage: number,
  fallbackRows: number,
): {
  currentPage: number;
  totalPages?: number;
  totalRecords?: number;
  rows: number;
  hasNext: boolean;
  next?: ParsedPage["next"];
} {
  const paginator = root.find(".ui-paginator, [role=navigation]").first();
  const externalPaginator = $(".ui-paginator, [role=navigation]").filter((_, element) =>
    /pagin|page/i.test(
      `${$(element).attr("class") ?? ""} ${$(element).attr("aria-label") ?? ""}`,
    ),
  ).first();
  const navigation = paginator.length > 0 ? paginator : externalPaginator;
  const text = normalizeSpace(navigation.text());
  const pageMatch = text.match(
    /(?:p[aá]gina|page)\s*(\d+)\s*(?:de|of|\/)\s*(\d+)(?:\s*\((\d+)\s*(?:registros?|records?)\))?/i,
  );
  const firstRowIndexRaw = root
    .find("tbody[id$='_data'] > tr[data-ri], tbody.ui-datatable-data > tr[data-ri]")
    .first()
    .attr("data-ri");
  const totalPages = pageMatch?.[2] ? Number(pageMatch[2]) : undefined;
  const totalRecords = pageMatch?.[3] ? Number(pageMatch[3]) : undefined;
  const tableId = root.attr("id") ?? deriveTableId(root);
  const rows = discoverRowsPerPage($, root, tableId, fallbackRows);
  const firstRowIndex =
    firstRowIndexRaw !== undefined ? Number(firstRowIndexRaw) : undefined;
  const pageFromRows =
    firstRowIndex !== undefined && Number.isFinite(firstRowIndex)
      ? Math.floor(firstRowIndex / rows) + 1
      : undefined;
  const currentPage =
    pageFromRows ??
    (pageMatch?.[1] ? Number(pageMatch[1]) : fallbackCurrentPage);
  const nextControl = navigation
    .find(".ui-paginator-next, a[aria-label='Next Page'], a[title*='iguiente'], a[title*='ext']")
    .first();
  const disabled =
    nextControl.hasClass("ui-state-disabled") ||
    nextControl.attr("aria-disabled") === "true" ||
    (totalPages !== undefined && currentPage >= totalPages);
  const hasNext = nextControl.length > 0 ? !disabled : totalPages !== undefined && currentPage < totalPages;
  if (!hasNext) {
    return {
      currentPage,
      ...(totalPages !== undefined ? { totalPages } : {}),
      ...(totalRecords !== undefined ? { totalRecords } : {}),
      rows,
      hasNext: false,
    };
  }

  if (tableId && root.hasClass("ui-datatable")) {
    return {
      currentPage,
      ...(totalPages !== undefined ? { totalPages } : {}),
      ...(totalRecords !== undefined ? { totalRecords } : {}),
      rows,
      hasNext: true,
      next: {
        kind: "primefaces",
        tableId,
        nextFirst: currentPage * rows,
        rows,
      },
    };
  }

  const href = nextControl.attr("href");
  if (href && !/^(#|javascript:)/i.test(href)) {
    return {
      currentPage,
      ...(totalPages !== undefined ? { totalPages } : {}),
      ...(totalRecords !== undefined ? { totalRecords } : {}),
      rows,
      hasNext: true,
      next: { kind: "url", url: new URL(href, baseUrl).toString() },
    };
  }

  const onclick = nextControl.attr("onclick") ?? "";
  const submitParams = parseSubmitParams(onclick);
  const controlId =
    primeFacesOption(onclick, "s") ??
    nextControl.attr("name") ??
    nextControl.attr("id") ??
    primarySubmitControl(submitParams);
  if (controlId) {
    return {
      currentPage,
      ...(totalPages !== undefined ? { totalPages } : {}),
      ...(totalRecords !== undefined ? { totalRecords } : {}),
      rows,
      hasNext: true,
      next: {
        kind: "jsf-action",
        action: {
          kind: "jsf-action",
          formId: form.id,
          controlId,
          params: { ...submitParams, [controlId]: controlId },
        },
      },
    };
  }

  return {
    currentPage,
    ...(totalPages !== undefined ? { totalPages } : {}),
    ...(totalRecords !== undefined ? { totalRecords } : {}),
    rows,
    hasNext: false,
  };
}

function deriveTableId(root: Selection): string | undefined {
  const bodyId = root.find("tbody[id$='_data']").attr("id");
  return bodyId?.replace(/_data$/, "");
}

function discoverRowsPerPage(
  $: CheerioAPI,
  root: Selection,
  tableId: string | undefined,
  fallback: number,
): number {
  const selectValue = root.find(".ui-paginator-rpp-options").attr("value");
  if (selectValue && Number(selectValue) > 0) return Number(selectValue);
  const dataRows = root.attr("data-rows");
  if (dataRows && Number(dataRows) > 0) return Number(dataRows);
  const scripts = $("script")
    .toArray()
    .map((script) => $(script).text())
    .filter((script) => !tableId || script.includes(tableId));
  for (const script of scripts) {
    const match = script.match(/\brows\s*:\s*(\d+)/);
    if (match?.[1] && Number(match[1]) > 0) return Number(match[1]);
  }
  return Math.max(1, fallback);
}

function deriveTitle(fields: Record<string, string>): string {
  const prioritized = Object.entries(fields)
    .filter(([key, value]) =>
      Boolean(value) && /resolucion|expediente|casacion|titulo|sumilla/i.test(normalizeKey(key)),
    )
    .map(([, value]) => value);
  const fallback = Object.values(fields).filter(Boolean);
  return normalizeSpace([...new Set(prioritized.length > 0 ? prioritized : fallback)].slice(0, 3).join(" - ")) || "Documento sin título";
}

function uniqueHeader(
  requested: string,
  fields: Record<string, string>,
): string {
  if (!(requested in fields)) return requested;
  let index = 2;
  while (`${requested} (${index})` in fields) index += 1;
  return `${requested} (${index})`;
}

function extractUrlFromJavascript(javascript: string): string | undefined {
  const patterns = [
    /window\.open\s*\(\s*["']([^"']+)["']/i,
    /(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i,
    /["']([^"']+\.pdf(?:\?[^"']*)?)["']/i,
  ];
  for (const pattern of patterns) {
    const match = javascript.match(pattern);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function parseSubmitParams(javascript: string): Record<string, string> {
  const result: Record<string, string> = {};
  const container = javascript.match(
    /(?:addSubmitParam\s*\([^,]+,|jsfcljs\s*\([^,]+,)\s*(\{[^}]*\})/i,
  )?.[1];
  if (!container) return result;
  const pairPattern = /["']([^"']+)["']\s*:\s*["']([^"']*)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pairPattern.exec(container)) !== null) {
    if (match[1] !== undefined && match[2] !== undefined) {
      result[match[1]] = match[2];
    }
  }
  return result;
}

function primarySubmitControl(
  params: Record<string, string>,
): string | undefined {
  return Object.keys(params).find(
    (name) =>
      !/^javax\.faces\./.test(name) &&
      !/^param[_:-]/i.test(name) &&
      params[name] === name,
  );
}

function primeFacesOption(
  javascript: string,
  option: "s" | "p" | "u",
): string | undefined {
  const aliases =
    option === "s"
      ? "s|source"
      : option === "p"
        ? "p|process"
        : "u|update";
  const match = javascript.match(
    new RegExp(`(?:^|[,\\s{])(?:${aliases})\\s*:\\s*[\"']([^\"']+)[\"']`),
  );
  return match?.[1];
}

function escapeAttribute(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
