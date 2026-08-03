import type { SourceName, SourceProfile } from "./types.js";

const PROFILES: Record<Exclude<SourceName, "custom">, SourceProfile> = {
  pj: {
    name: "pj",
    label: "Jurisprudencia Nacional Sistematizada (Poder Judicial del Perú)",
    url: "https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/resultado.xhtml",
    requiresPeruVpn: true,
  },
  oefa: {
    name: "oefa",
    label: "Repositorio Digital OEFA (sitio alternativo)",
    url: "https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml",
    requiresPeruVpn: false,
    tableSelector: ".ui-datatable",
  },
};

export function getProfile(name: "pj" | "oefa"): SourceProfile {
  return { ...PROFILES[name] };
}

export function customProfile(url: string): SourceProfile {
  return {
    name: "custom",
    label: "Fuente JSF personalizada",
    url,
    requiresPeruVpn: false,
  };
}
