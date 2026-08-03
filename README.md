# Scraper de resoluciones OEFA

Scraper HTTP escrito en TypeScript para extraer resoluciones del [Repositorio Digital del OEFA](https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml), recorrer todas las páginas de resultados y descargar los PDFs asociados.

Este es el sitio alternativo sin VPN permitido por el enunciado del desafío. El proyecto no usa Puppeteer, Playwright, Selenium, WebDriver ni automatización de navegador: Axios realiza las solicitudes HTTP, Cheerio analiza HTML/XML y el cliente JSF conserva cookies, `javax.faces.ViewState` y el estado de PrimeFaces entre solicitudes.

## Funcionalidades

- Descubrimiento dinámico del formulario, tabla, columnas, botón de búsqueda y paginador JSF.
- Extracción de todas las columnas disponibles sin depender de IDs JSF variables.
- Soporte para respuestas parciales AJAX de PrimeFaces.
- Recorrido completo de páginas con protección contra ciclos.
- Descarga de enlaces PDF y acciones `mojarra.jsfcljs`/JSF.
- Validación de cada archivo mediante la firma `%PDF-`.
- Pausa configurable entre solicitudes.
- Reintentos de HTTP 429 y 5xx con backoff exponencial, jitter y `Retry-After`.
- Cola persistente de descargas fallidas.
- Escritura incremental en JSONL y deduplicación de documentos.
- Límites opcionales para ejecutar demostraciones pequeñas.

## Requisitos

- Node.js 20 o superior.
- npm.

OEFA es la fuente predeterminada y no requiere VPN.

## Instalación

```bash
git clone https://github.com/AdrielLopez/pj-jurisprudencia-scraper.git
cd pj-jurisprudencia-scraper
npm install
```

## Ejecución rápida

Probar una página y hasta cinco documentos:

```bash
npm start -- --max-pages 1 --max-documents 5
```

Probar solamente la extracción de metadatos, sin descargar PDFs:

```bash
npm start -- --max-pages 1 --no-download
```

Dejar que recorra todas las páginas y descargue todos los PDFs:

```bash
npm start
```

Reintentar únicamente los documentos que quedaron en la cola de fallos:

```bash
npm run retry:failed
```

El reintento vuelve a recorrer la consulta para obtener una sesión y un `ViewState` vigentes. Solo descarga los IDs presentes en `output/data/failures.json`.

### Opciones

| Opción | Descripción | Predeterminado |
|---|---|---:|
| `--source oefa\|pj` | Perfil de fuente | `oefa` |
| `--url URL` | Endpoint JSF personalizado | — |
| `--output-dir RUTA` | Directorio de salida | `output` |
| `--max-pages N` | Máximo de páginas | sin límite |
| `--max-documents N` | Máximo de documentos | sin límite |
| `--delay-ms N` | Pausa mínima entre solicitudes | `1200` |
| `--request-timeout-ms N` | Timeout de cada solicitud | `30000` |
| `--retries N` | Reintentos adicionales ante 429/5xx | `5` |
| `--backoff-ms N` | Base del backoff exponencial | `2000` |
| `--filter campo=valor` | Filtro JSF; se puede repetir | — |
| `--table-selector CSS` | Fuerza el selector CSS de la tabla | — |
| `--no-download` | Extrae solamente metadatos | desactivado |
| `--retry-failed` | Descarga solamente la cola de fallos | desactivado |
| `--debug` | Muestra diagnóstico de la sesión JSF | desactivado |
| `--help` | Muestra la ayuda completa | — |

Los filtros aceptan el atributo `name` exacto del control JSF o su sufijo. Por ejemplo:

```bash
npm start -- --filter txtNroexp=891-08-PRODUCE/DIGSECOVI-Dsvs
```

## Fuente PJ conservada

El perfil original del Poder Judicial permanece disponible como compatibilidad opcional:

```bash
npm start -- --source pj --max-pages 1
```

Ese servidor restringe geográficamente el acceso y requiere que el sistema ya tenga una conexión con salida en Perú. Esta condición no afecta la entrega ni las pruebas del scraper sobre OEFA.

## Salida

```text
output/
├── data/
│   ├── documents.jsonl  # una línea JSON por documento
│   ├── downloads.jsonl  # descargas correctas y ruta local
│   └── failures.json    # cola actual de descargas fallidas
└── pdfs/
    └── <titulo-descriptivo>-<id>.pdf
```

Cada documento contiene un ID estable, fuente, URL, página, orden de aparición, todas las columnas de la tabla, título, referencia de descarga y fecha de extracción. Si un PDF ya existe y tiene una firma válida, no vuelve a descargarse.

## Manejo de rate limiting

Para cada respuesta 429, el cliente calcula:

```text
espera = max(Retry-After, backoffBase × 2^(intento-1) + jitter)
```

Después del máximo de intentos, el error se guarda en `output/data/failures.json` y el scraper continúa con el siguiente documento. También se reintentan HTTP 5xx y errores transitorios de red. Los demás HTTP 4xx se consideran permanentes.

El proceso termina con código `2` cuando quedaron PDFs fallidos, lo que permite detectarlo desde CI sin perder los resultados correctos.

## Desarrollo y pruebas

```bash
npm run check
npm run build
```

La suite automatizada cubre parsing de formularios y tablas JSF, extracción de acciones PDF, respuestas AJAX parciales, paginación PrimeFaces, argumentos de CLI y la secuencia `429 → 429 → PDF` con backoff exponencial.

La integración también fue comprobada contra el sitio OEFA real recorriendo páginas consecutivas y descargando un PDF mediante una acción `mojarra.jsfcljs`.

## Estructura interna

```text
src/
├── cli.ts           # argumentos y validación
├── http-client.ts   # cookies, rate limiting, retry y backoff
├── jsf-parser.ts    # descubrimiento y parsing HTML/XML
├── jsf-client.ts    # sesión, búsqueda, paginación y acciones JSF
├── downloader.ts    # validación y escritura segura de PDFs
├── storage.ts       # JSONL, deduplicación y cola de fallos
├── scraper.ts       # orquestación del recorrido
└── index.ts         # punto de entrada
```

## Uso responsable

El scraper incluye una pausa conservadora de 1,2 segundos entre solicitudes. Respeta los términos del sitio, evita ejecuciones paralelas innecesarias y utiliza límites pequeños durante el desarrollo.

## Licencia

MIT. Consulta [LICENSE](./LICENSE).
