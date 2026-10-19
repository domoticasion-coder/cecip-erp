import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";

/**
 * En producción, Vercel ejecuta cada archivo de /api como función serverless.
 * En desarrollo, este plugin hace lo mismo dentro del servidor de Vite:
 * /api/pagos/link -> api/pagos/link.ts (exporta GET/POST con firma Web Request/Response).
 */
function devApi(): Plugin {
  return {
    name: "dev-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || "/", "http://localhost");
        if (!url.pathname.startsWith("/api/")) return next();

        const file = path.join(process.cwd(), url.pathname + ".ts");
        if (!fs.existsSync(file) || url.pathname.includes("/_lib/")) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: "Not found" }));
          return;
        }

        try {
          const mod = await server.ssrLoadModule(file);
          const handler = mod[req.method || "GET"];
          if (typeof handler !== "function") {
            res.statusCode = 405;
            res.end(JSON.stringify({ error: "Method not allowed" }));
            return;
          }

          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const body = chunks.length ? Buffer.concat(chunks) : undefined;

          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) {
            if (typeof v === "string") headers.set(k, v);
            else if (Array.isArray(v)) headers.set(k, v.join(", "));
          }

          const request = new Request(`http://${req.headers.host}${req.url}`, {
            method: req.method,
            headers,
            body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
          });

          const response: Response = await handler(request);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          console.error("[dev-api]", err);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
    },
  };
}

/**
 * Solo en `npm run demo` (servidor local): deja que el Copiloto de la demo use Gemini real
 * si GEMINI_API_KEY está en el .env. No existe en producción (Vercel no ejecuta este plugin).
 */
function demoCopilotGemini(): Plugin {
  return {
    name: "demo-copilot-gemini",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/dev-api/variantes", async (req, res) => {
        res.setHeader("content-type", "application/json; charset=utf-8");
        if (req.method !== "POST") { res.statusCode = 405; return res.end("{}"); }
        if (!process.env.GEMINI_API_KEY) { res.statusCode = 503; return res.end(JSON.stringify({ sinClave: true })); }
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const { mensaje, cantidad } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const mod = await server.ssrLoadModule(path.join(process.cwd(), "api/_lib/copilot.ts"));
          const variantes = await mod.variantesGemini(String(mensaje || ""), Number(cantidad) || 6);
          res.end(JSON.stringify({ variantes }));
        } catch (err) {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });
      server.middlewares.use("/dev-api/copilot", async (req, res) => {
        res.setHeader("content-type", "application/json; charset=utf-8");
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end("{}");
        }
        if (!process.env.GEMINI_API_KEY) {
          res.statusCode = 503;
          return res.end(JSON.stringify({ sinClave: true }));
        }
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const { contexto, historial, pregunta, ambito } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const mod = await server.ssrLoadModule(path.join(process.cwd(), "api/_lib/copilot.ts"));
          const erp = ambito === "erp" ? await server.ssrLoadModule(path.join(process.cwd(), "shared/copilotErp.ts")) : null;
          const respuesta = await mod.preguntarGemini(String(contexto || ""), Array.isArray(historial) ? historial : [],
            String(pregunta || "").slice(0, 4000), ...(erp ? [erp.INSTRUCCIONES_ERP] : []));
          res.end(JSON.stringify({ respuesta }));
        } catch (err) {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Las funciones /api leen process.env (igual que en Vercel)
  const env = loadEnv(mode, process.cwd(), "");
  // Las variables del sistema tienen prioridad; las del .env se actualizan cuando el archivo cambia
  const g = globalThis as { __cecipEnvDelArchivo?: Set<string> };
  const delArchivo = (g.__cecipEnvDelArchivo ??= new Set<string>());
  for (const [k, v] of Object.entries(env)) {
    if (process.env[k] === undefined || process.env[k] === "" || delArchivo.has(k)) {
      process.env[k] = v;
      delArchivo.add(k);
    }
  }

  // `npm run demo` usa una base de datos local de ejemplo en lugar de Supabase
  const demo = mode === "demo";

  return {
    // NEXT_PUBLIC_*: nombres que crea la integración Supabase de Vercel (URL y clave pública)
    envPrefix: ["VITE_", "NEXT_PUBLIC_"],
    plugins: [react(), tailwindcss(), ...(demo ? [demoCopilotGemini()] : [devApi()])],
    resolve: {
      alias: [{ find: /^@backend$/, replacement: path.resolve(__dirname, demo ? "src/demo/backend.ts" : "src/lib/backend.ts") }],
    },
    optimizeDeps: { exclude: ["@electric-sql/pglite"] },
    server: { port: 5173 },
  };
});
