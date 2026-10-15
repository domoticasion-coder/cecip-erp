import { supabase } from "./supabase";

const MAX_LADO = 1600;
const MAX_BYTES = 5 * 1024 * 1024;

/** Achica la imagen (lado mayor 1600 px) para que los emails y WhatsApp carguen rápido */
async function reducir(file: File): Promise<Blob> {
  if (file.type === "image/gif") return file; // los GIF animados se suben como están
  try {
    const bmp = await createImageBitmap(file);
    const escala = Math.min(1, MAX_LADO / Math.max(bmp.width, bmp.height));
    if (escala === 1 && file.size < 800_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * escala);
    canvas.height = Math.round(bmp.height * escala);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const tipo = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, tipo, 0.85));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

/** Sube una imagen al bucket público "imagenes" y devuelve su URL */
export async function subirImagen(file: File, carpeta = "comunicacion"): Promise<string> {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error("La imagen tiene que ser JPG, PNG, WEBP o GIF.");
  const blob = await reducir(file);
  if (blob.size > MAX_BYTES) throw new Error("La imagen pesa más de 5 MB. Probá con una más liviana.");
  const ext = { "image/png": "png", "image/gif": "gif", "image/webp": "webp" }[blob.type] || "jpg";
  const path = `${carpeta}/${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const bucket = supabase.storage.from("imagenes");
  const { error } = await bucket.upload(path, blob, { contentType: blob.type, cacheControl: "31536000", upsert: false });
  if (error) throw new Error(/bucket not found/i.test(error.message) ? "Falta crear el bucket de imágenes (ejecutá la migración 005 en Supabase)." : error.message);
  return bucket.getPublicUrl(path).data.publicUrl;
}

/** Copia la imagen al portapapeles (para pegarla en WhatsApp Web con Ctrl+V) */
export async function copiarImagen(url: string): Promise<void> {
  const res = await fetch(url);
  const original = await res.blob();
  // El portapapeles solo acepta PNG
  const png = original.type === "image/png" ? original : await new Promise<Blob>((resolve, reject) => {
    createImageBitmap(original).then((bmp) => {
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext("2d")!.drawImage(bmp, 0, 0);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo convertir la imagen."))), "image/png");
    }, reject);
  });
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}
