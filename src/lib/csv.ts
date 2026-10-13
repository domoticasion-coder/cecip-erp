/** Descarga un CSV compatible con Excel (separador ";" y BOM UTF-8). */
export function descargarCSV(nombre: string, filas: Record<string, unknown>[], columnas?: { key: string; label: string }[]) {
  if (filas.length === 0) return;
  const cols = columnas || Object.keys(filas[0]).map((k) => ({ key: k, label: k }));
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? String(v).replace(".", ",") : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.map((c) => esc(c.label)).join(";"), ...filas.map((f) => cols.map((c) => esc(f[c.key])).join(";"))].join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nombre.endsWith(".csv") ? nombre : `${nombre}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Parser de CSV tolerante: detecta "," o ";" y respeta comillas. */
export function parseCSV(texto: string): Record<string, string>[] {
  const t = texto.replace(/^﻿/, "");
  const primera = t.split(/\r?\n/)[0] || "";
  const sep = (primera.match(/;/g) || []).length > (primera.match(/,/g) || []).length ? ";" : primera.includes("\t") ? "\t" : ",";

  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let comillas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (comillas) {
      if (ch === '"' && t[i + 1] === '"') { campo += '"'; i++; }
      else if (ch === '"') comillas = false;
      else campo += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === sep) { fila.push(campo); campo = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      fila.push(campo); campo = "";
      if (fila.some((c) => c.trim() !== "")) filas.push(fila);
      fila = [];
    } else campo += ch;
  }
  fila.push(campo);
  if (fila.some((c) => c.trim() !== "")) filas.push(fila);

  if (filas.length < 2) return [];
  const headers = filas[0].map((h) =>
    h.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")
  );
  return filas.slice(1).map((f) => Object.fromEntries(headers.map((h, i) => [h, (f[i] || "").trim()])));
}
