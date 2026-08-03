export class HttpStatusError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
    readonly responseBody?: string,
  ) {
    super(message);
    this.name = "HttpStatusError";
  }
}

export class PdfValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfValidationError";
  }
}

export class SiteStructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SiteStructureError";
  }
}

export class VpnRequiredError extends Error {
  constructor(url: string, status: number) {
    super(
      `El sitio objetivo respondió HTTP ${status}. Conecta una VPN con salida en Perú y vuelve a ejecutar el scraper: ${url}`,
    );
    this.name = "VpnRequiredError";
  }
}
