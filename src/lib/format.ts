const ars = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });
export const pesos = (n: number | string | null | undefined) => ars.format(Number(n || 0));

/** Fecha "YYYY-MM-DD" o ISO -> "dd/mm/aaaa" sin corrimientos de zona horaria */
export function fecha(d: string | null | undefined): string {
  if (!d) return "—";
  const s = d.length === 10 ? d + "T12:00:00" : d;
  return new Date(s).toLocaleDateString("es-AR");
}

export function fechaHora(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

export const hoyISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export function nombrePeriodo(periodo: string | null | undefined): string {
  if (!periodo) return "—";
  const [y, m] = periodo.split("-").map(Number);
  return `${MESES[m - 1]} ${y}`;
}

export function formatCuit(c: string | null | undefined): string {
  const d = (c || "").replace(/\D/g, "");
  if (d.length !== 11) return c || "";
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
}

/** Valida el dígito verificador de un CUIT/CUIL argentino */
export function cuitValido(c: string): boolean {
  const d = c.replace(/\D/g, "");
  if (d.length !== 11) return false;
  const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = mult.reduce((acc, m, i) => acc + m * Number(d[i]), 0);
  let dv = 11 - (sum % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) dv = 9;
  return dv === Number(d[10]);
}

export const nombreSocio = (s: { nombre_comercial?: string | null; razon_social: string }) =>
  s.nombre_comercial || s.razon_social;
