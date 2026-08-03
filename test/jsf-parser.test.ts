import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyFilters,
  extractFormState,
  findSearchAction,
  parsePartialResponse,
  parseResultPage,
} from "../src/jsf-parser.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(directory, "fixtures", "results-page.html");
const baseUrl = "https://example.test/faces/page/resultado.xhtml";

test("descubre formulario, acción de búsqueda y filtros JSF dinámicos", async () => {
  const html = await readFile(fixturePath, "utf8");
  const form = extractFormState(html, baseUrl);
  assert.equal(form.id, "consultaForm");
  assert.equal(form.fields["javax.faces.ViewState"], "state-1");
  assert.equal(
    form.actionUrl,
    "https://example.test/faces/page/resultado.xhtml;jsessionid=abc",
  );

  const search = findSearchAction(html, baseUrl);
  assert.ok(search);
  assert.equal(search.ajax, true);
  assert.equal(search.reference.controlId, "consultaForm:j_idt37");
  assert.equal(search.update, "consultaForm:panel");

  const filtered = applyFilters(form, html, { expediente: "00123-2024" });
  assert.equal(filtered.fields["consultaForm:expediente"], "00123-2024");
});

test("extrae todas las columnas, PDFs y paginación PrimeFaces", async () => {
  const html = await readFile(fixturePath, "utf8");
  const page = parseResultPage(html, {
    source: "pj",
    sourceUrl: baseUrl,
    pageNumber: 1,
  });

  assert.equal(page.records.length, 2);
  assert.equal(page.records[0]?.fields["Número de expediente"], "00123-2024");
  assert.deepEqual(page.records[0]?.pdf, {
    kind: "url",
    url: "https://example.test/documentos/resolucion-123.pdf",
  });
  assert.equal(page.records[1]?.pdf?.kind, "jsf-action");
  if (page.records[1]?.pdf?.kind === "jsf-action") {
    assert.equal(
      page.records[1].pdf.controlId,
      "consultaForm:tablaDinamica:1:j_idt99",
    );
    assert.equal(page.records[1].pdf.params.param_uuid, "fixture-uuid");
  }
  assert.equal(page.currentPage, 1);
  assert.equal(page.totalPages, 3);
  assert.equal(page.totalRecords, 6);
  assert.equal(page.rowsPerPage, 2);
  assert.deepEqual(page.next, {
    kind: "primefaces",
    tableId: "consultaForm:tablaDinamica",
    nextFirst: 2,
    rows: 2,
  });
});

test("aplica una respuesta parcial JSF y renueva ViewState", async () => {
  const html = await readFile(fixturePath, "utf8");
  const partial = `<?xml version="1.0" encoding="UTF-8"?>
    <partial-response>
      <changes>
        <update id="consultaForm:panel"><![CDATA[
          <span id="consultaForm:panel"><div class="nuevo">Página actualizada</div></span>
        ]]></update>
        <update id="javax.faces.ViewState"><![CDATA[state-2]]></update>
      </changes>
    </partial-response>`;

  const updated = parsePartialResponse(html, partial, baseUrl);
  assert.match(updated.html, /Página actualizada/);
  assert.match(updated.html, /value="state-2"/);
  assert.equal(updated.viewState, "state-2");
});

test("conserva el DataTable cuando PrimeFaces actualiza solo filas", async () => {
  const html = await readFile(fixturePath, "utf8");
  const partial = `<?xml version="1.0" encoding="UTF-8"?>
    <partial-response><changes>
      <update id="consultaForm:tablaDinamica"><![CDATA[
        <tr data-ri="2"><td>3</td><td>00789-2024</td><td>Empresa Tres</td><td><a href="/documentos/tres.pdf">PDF</a></td></tr>
        <tr data-ri="3"><td>4</td><td>00999-2024</td><td>Empresa Cuatro</td><td><a href="/documentos/cuatro.pdf">PDF</a></td></tr>
      ]]></update>
      <update id="javax.faces.ViewState"><![CDATA[state-page-2]]></update>
    </changes></partial-response>`;
  const updated = parsePartialResponse(html, partial, baseUrl);
  const page = parseResultPage(updated.html, {
    source: "pj",
    sourceUrl: baseUrl,
    pageNumber: 2,
  });

  assert.equal(page.records.length, 2);
  assert.equal(page.records[0]?.fields["Número de expediente"], "00789-2024");
  assert.equal(page.currentPage, 2);
  assert.deepEqual(page.next, {
    kind: "primefaces",
    tableId: "consultaForm:tablaDinamica",
    nextFirst: 4,
    rows: 2,
  });
});
