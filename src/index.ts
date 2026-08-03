#!/usr/bin/env node
import { HELP, parseCli } from "./cli.js";
import { HttpStatusError, VpnRequiredError } from "./errors.js";
import { Logger } from "./logger.js";
import { Scraper } from "./scraper.js";
import { errorMessage } from "./utils.js";

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  if (cli.help) {
    console.log(HELP.trim());
    return;
  }
  const logger = new Logger(cli.debug);
  const scraper = new Scraper(cli.config, logger);
  const summary = await scraper.run();
  logger.info("Ejecución terminada", {
    paginas: summary.pagesVisited,
    documentosVistos: summary.documentsSeen,
    documentosNuevos: summary.documentsSaved,
    pdfsDescargados: summary.pdfsDownloaded,
    pdfsFallidos: summary.pdfsFailed,
    motivo: summary.stoppedReason,
  });
  if (summary.pdfsFailed > 0) process.exitCode = 2;
}

main().catch((error: unknown) => {
  if (error instanceof VpnRequiredError) {
    console.error(`VPN requerida: ${error.message}`);
    process.exitCode = 3;
    return;
  }
  if (error instanceof HttpStatusError) {
    console.error(`Error HTTP ${error.status}: ${error.message}`);
    process.exitCode = 4;
    return;
  }
  console.error(`Error fatal: ${errorMessage(error)}`);
  process.exitCode = 1;
});
