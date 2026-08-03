# Scraper de Jurisprudencia del Poder Judicial del Perú

Scraper HTTP escrito en TypeScript para extraer los documentos de la [Jurisprudencia Nacional Sistematizada del Poder Judicial del Perú](https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/inicio.xhtml), recorrer todas sus páginas y descargar los PDFs asociados. La navegación comienza en `inicio.xhtml`, envía el formulario JSF real y sigue su redirección a `resultado.xhtml`.

El proyecto no usa Puppeteer, Playwright, Selenium, WebDriver ni ninguna otra automatización de navegador. La comunicación se realiza con Axios; Cheerio analiza HTML/XML y un cliente JSF conserva cookies, `javax.faces.ViewState` y el estado de PrimeFaces entre solicitudes.

## Funcionalidades

- Descubrimiento dinámico del formulario, tabla, columnas, botón de búsqueda y paginador JSF.
- Extracción de todas las columnas disponibles sin depender de identificadores variables como `j_idt37`.
- Soporte para respuestas parciales AJAX de PrimeFaces y actualizaciones que contienen solo filas.
- Paginación completa con protección contra ciclos o páginas repetidas.
- Descarga de enlaces PDF directos y acciones `mojarra.jsfcljs`/JSF.
- Nombres de archivo descriptivos y seguros para Windows, macOS y Linux.
- Validación del contenido mediante la firma `%PDF-`; una página HTML no se guarda como PDF.
- Cookies de sesión persistentes y seguimiento de redirecciones.
- Proxy HTTP(S) explícito con afinidad de sesión, autenticación opcional y túneles persistentes.
- Descubrimiento experimental de proxies públicos peruanos desde Litport, Databay, ProxyScrape y GeoNode, con rotación automática y timeout estricto por candidato.
- Pausa configurable entre todas las solicitudes.
- Reintentos de HTTP 429 y 5xx con backoff exponencial, jitter y soporte de `Retry-After`.
- Cola persistente de descargas fallidas para reintentarlas en una ejecución posterior con una sesión JSF nueva.
- Salida incremental JSONL para poder procesar grandes cantidades de documentos sin conservar todo el dataset en memoria.
- Límites opcionales de páginas y documentos para ejecuciones de demostración.

## Requisitos

- Node.js 20 o superior.
- npm.
- Para la fuente principal, una VPN o conexión con salida en Perú. Fuera de esa región el servidor responde `403 Forbidden`.

El repositorio de OEFA está configurado como fuente alternativa pública para desarrollar y probar el flujo sin VPN:

`https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml`

## Instalación

```bash
git clone https://github.com/AdrielLopez/pj-jurisprudencia-scraper.git
cd pj-jurisprudencia-scraper
npm install
```

## Uso

Conviene comenzar con una ejecución pequeña:

```bash
npm start -- --source pj --max-pages 1 --max-documents 5
```

Con un proxy peruano estable:

```bash
npm start -- --source pj --proxy http://usuario:clave@host:puerto --max-pages 1 --max-documents 5
```

Como alternativa de prueba, el programa puede descubrir proxies públicos de Perú y rotarlos. Como esos servidores aparecen y desaparecen constantemente, puede ser necesario ejecutar el comando nuevamente:

```bash
npm start -- --source pj --free-proxy-peru --filter txtBusqueda=casacion --max-pages 1 --max-documents 5 --no-download --request-timeout-ms 8000
```

Una VPN o un proxy propio estable es la opción recomendada para recorrer páginas y descargar PDFs. Los proxies públicos son compartidos, pueden registrar los destinos solicitados y muchos aceptan una sola conexión antes de dejar de responder. El scraper mantiene la verificación TLS habilitada, pero no se deben enviar credenciales ni información privada mediante `--free-proxy-peru`.

Procesar la fuente principal completa:

```bash
npm start -- --source pj
```

Probar una página del sitio alternativo sin descargar PDFs:

```bash
npm start -- --source oefa --max-pages 1 --no-download
```

Reintentar únicamente los documentos que quedaron en la cola de fallos:

```bash
npm start -- --source pj --retry-failed
```

El reintento vuelve a recorrer la consulta para obtener una sesión, un `ViewState` y controles de fila vigentes. Solo descarga los IDs presentes en `failures.json`; no reutiliza tokens JSF vencidos.

### Opciones

| Opción | Descripción | Predeterminado |
|---|---|---:|
| `--source pj\|oefa` | Perfil de fuente | `pj` |
| `--url URL` | Endpoint JSF personalizado | — |
| `--output-dir RUTA` | Directorio de salida | `output` |
| `--max-pages N` | Máximo de páginas | sin límite |
| `--max-documents N` | Máximo de documentos | sin límite |
| `--delay-ms N` | Pausa mínima entre requests | `1200` |
| `--request-timeout-ms N` | Timeout de cada request | `30000` |
| `--retries N` | Reintentos adicionales ante 429/5xx | `5` |
| `--backoff-ms N` | Base del backoff exponencial | `2000` |
| `--filter campo=valor` | Filtro JSF; se puede repetir | — |
| `--table-selector CSS` | Fuerza la tabla si el autodiscovery no basta | — |
| `--proxy URL` | Usa un proxy HTTP(S) estable; acepta autenticación en la URL | — |
| `--free-proxy-peru` | Descubre y rota proxies públicos peruanos | desactivado |
| `--no-download` | Extrae solo metadatos | desactivado |
| `--retry-failed` | Descarga solo la cola de fallos | desactivado |
| `--debug` | Muestra diagnóstico de la sesión JSF | desactivado |
| `--help` | Muestra la ayuda completa | — |

Los filtros aceptan el atributo `name` exacto del control JSF o su sufijo. Por ejemplo:

```bash
npm start -- --source oefa --filter txtNroexp=891-08-PRODUCE/DIGSECOVI-Dsvs
```

## Salida

```text
output/
├── data/
│   ├── documents.jsonl  # metadatos; una línea JSON por documento
│   ├── downloads.jsonl  # descargas correctas y ruta local
│   └── failures.json    # cola actual de descargas fallidas
└── pdfs/
    └── <titulo-descriptivo>-<id>.pdf
```

Cada documento contiene:

- ID estable derivado de sus metadatos, no de la posición de la fila.
- Fuente, URL, página y orden de aparición.
- Todas las columnas de la tabla dentro de `fields`.
- Título descriptivo derivado de resolución/expediente.
- Referencia de descarga directa o acción JSF y parámetros necesarios.
- Fecha de extracción en UTC.

JSONL permite escribir de forma incremental y reanudar sin duplicar documentos ya registrados. Si un PDF ya existe y tiene una firma válida, no vuelve a descargarse.

## Manejo de rate limiting

Para cada respuesta 429, el cliente calcula:

```text
espera = max(Retry-After, backoffBase × 2^(intento-1) + jitter)
```

Después del máximo de intentos, el error se registra en `output/data/failures.json` y el scraper continúa con el siguiente documento. HTTP 5xx y errores transitorios de red también se reintentan; errores 4xx permanentes no se repiten, salvo 429.

El proceso termina con código `2` cuando quedaron PDFs fallidos, lo que permite detectarlo desde CI o un job programado sin perder el resto de los resultados.

## Desarrollo y pruebas

```bash
npm run typecheck
npm test
npm run build
```

La suite automatizada cubre:

- descubrimiento de formularios y controles con IDs JSF dinámicos;
- extracción de columnas y acciones PDF directas/JSF;
- respuestas parciales AJAX y actualización de `ViewState`;
- reemplazo de filas y paginación PrimeFaces;
- reintentos `429 → 429 → PDF` con backoff exponencial;
- validación de argumentos de CLI;
- normalización de proxies, puertos predeterminados y ocultamiento de credenciales en logs;
- detección del botón `input[type=image]` y de los parámetros escapados de Mojarra usados por el sitio principal.

La integración se comprobó contra el sitio alternativo real recorriendo páginas consecutivas y descargando un PDF mediante una acción `mojarra.jsfcljs`. En el sitio principal se verificaron respuestas 200 desde IPs peruanas, la apertura de `inicio.xhtml`, la extracción del `ViewState` y el envío del POST JSF real. La disponibilidad de proxies públicos no es una garantía de funcionamiento continuo; una salida peruana estable es necesaria para una prueba integral reproducible.

## Estructura interna

```text
src/
├── cli.ts           # argumentos y validación
├── http-client.ts   # cookies, proxy, rate limit, retry y backoff
├── proxy.ts        # validación y descubrimiento de proxies peruanos
├── jsf-parser.ts    # descubrimiento y parsing HTML/XML
├── jsf-client.ts    # sesión, búsqueda, paginación y acciones JSF
├── downloader.ts    # validación y escritura segura de PDFs
├── storage.ts       # JSONL, deduplicación y cola de fallos
├── scraper.ts       # orquestación del recorrido
└── index.ts         # punto de entrada
```

## Uso responsable

El scraper incluye una pausa conservadora de 1,2 segundos entre solicitudes. Ajustarla a cero contra un servicio público no es recomendable fuera de pruebas puntuales. Respeta los términos del sitio, evita ejecuciones paralelas innecesarias y utiliza límites pequeños durante el desarrollo.

## Licencia

MIT. Consulta [LICENSE](./LICENSE).
