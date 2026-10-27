import { HttpError, json } from "../_lib/core.js";
import { enviarComunicacion } from "../_lib/comunicaciones/enviar.js";
import { variantesMensaje } from "../_lib/comunicaciones/variantes.js";

/**
 * Un solo endpoint para Comunicación (así no se suman funciones en Vercel):
 *  POST /api/comunicaciones/enviar     email a socios (masivo, con cola) o a direcciones sueltas
 *  POST /api/comunicaciones/variantes  reescrituras de un mensaje de WhatsApp con IA
 */
export const POST = async (req: Request) => {
  const accion = new URL(req.url).pathname.split("/").filter(Boolean).pop();
  if (accion === "enviar") return enviarComunicacion(req);
  if (accion === "variantes") return variantesMensaje(req);
  return json({ error: new HttpError(404, "Acción inexistente.").message }, 404);
};
