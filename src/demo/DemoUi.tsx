import { useEffect, useState } from "react";
import { FlaskConical, CreditCard, CheckCircle2 } from "lucide-react";
import { appMode, ERP_URL, PORTAL_URL } from "../lib/appMode";
import { useAuth } from "../lib/auth";
import { pesos } from "../lib/format";
import { Button, Loading, cx } from "../components/ui";
import { DEMO_USERS, reiniciarDemo } from "./demoDb";
import { demoEntrarComo } from "./demoClient";
import { demoAcreditarPago, demoResumenPago } from "./demoApi";

const ETIQUETAS_DEMO = {
  admin: "Admin", administracion: "Administración", prensa: "Prensa y capac.", presidente: "Presidente",
  prosecretario: "Prosecretario", comision: "Comisión directiva", tesoreria: "Tesorería", atencion: "Atención", comercia: "ComercIA",
} as const;

/** Barra flotante del modo demo: aviso + cambio de rol (ERP) + accesos rápidos */
export function DemoBanner() {
  const { session } = useAuth();
  const [abierto, setAbierto] = useState(true);
  const actual = Object.entries(DEMO_USERS).find(([, u]) => u.id === session?.user.id)?.[0];

  if (!session) return null; // en la pantalla de ingreso no se muestra

  if (!abierto) {
    return (
      <button onClick={() => setAbierto(true)} className="no-print fixed bottom-4 left-4 z-[70] rounded-full bg-amber-400 p-2.5 text-amber-950 shadow-lg" title="Modo demo">
        <FlaskConical className="h-5 w-5" />
      </button>
    );
  }

  return (
    <div className="no-print fixed bottom-4 left-4 z-[70] w-72 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 shadow-xl">
      <div className="mb-1 flex items-center justify-between">
        <b className="flex items-center gap-1.5"><FlaskConical className="h-4 w-4" /> MODO DEMO</b>
        <button onClick={() => setAbierto(false)} className="text-amber-700 hover:underline">ocultar</button>
      </div>
      <p className="mb-2 text-amber-800">Datos de ejemplo guardados solo en este navegador. No se envían emails ni se cobra nada.</p>
      {appMode.app === "erp" && (
        <>
          <div className="mb-1 font-semibold">Ver el ERP como:</div>
          <div className="grid grid-cols-2 gap-1">
            {(["admin", "administracion", "prensa", "presidente", "prosecretario", "comision", "tesoreria", "atencion", "comercia"] as const).map((k) => (
              <button key={k} onClick={() => demoEntrarComo(k)}
                className={cx("rounded-md border px-1.5 py-1", actual === k ? "border-amber-600 bg-amber-200 font-semibold" : "border-amber-300 bg-white hover:bg-amber-100")}>
                {ETIQUETAS_DEMO[k]}
              </button>
            ))}
          </div>
        </>
      )}
      <button onClick={() => confirm("¿Borrar todo lo que hiciste y volver a los datos de ejemplo?") && reiniciarDemo()} className="mt-2 w-full rounded-md border border-amber-300 bg-white px-2 py-1 hover:bg-amber-100">Reiniciar demo</button>
      <div className="mt-2 flex justify-between">
        <a href={ERP_URL} className="font-medium underline">Ir al ERP</a>
        <a href={PORTAL_URL} className="font-medium underline">Ir al Portal de socios</a>
      </div>
    </div>
  );
}

/** Reemplaza al checkout de Mercado Pago en la demo */
export function DemoCheckout() {
  const ids = (new URLSearchParams(window.location.search).get("ids") || "").split(",").filter(Boolean);
  const [items, setItems] = useState<any[] | null>(null);
  const [estado, setEstado] = useState<"listo" | "pagando" | "pagado">("listo");

  useEffect(() => {
    demoResumenPago(ids).then(setItems);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!items) return <Loading />;
  const total = items.filter((i) => i.estado === "pendiente").reduce((a, i) => a + Number(i.total), 0);

  async function pagar() {
    setEstado("pagando");
    await demoAcreditarPago(ids);
    setEstado("pagado");
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-sky-50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-sky-700">
          <CreditCard className="h-5 w-5" /> Mercado Pago · <span className="rounded bg-amber-200 px-1.5 text-amber-900">SIMULACIÓN</span>
        </div>
        {estado === "pagado" ? (
          <div className="space-y-3 text-center">
            <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
            <div className="text-lg font-semibold">¡Pago aprobado!</div>
            <p className="text-sm text-slate-600">Las cuotas quedaron acreditadas, con recibo y movimiento en tesorería, igual que cuando Mercado Pago avisa al sistema.</p>
            <div className="flex justify-center gap-2">
              <a href={`${PORTAL_URL}/cuotas?pago=ok`}><Button>Ver en el portal</Button></a>
              <a href={`${ERP_URL}/cuotas?estado=pagada`}><Button variant="secondary">Ver en el ERP</Button></a>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-1 text-sm text-slate-500">Pagás a: Centro Comercial e Industrial de Paraná</div>
            <ul className="my-4 divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
              {items.map((i) => (
                <li key={i.id} className="flex justify-between px-3 py-2">
                  <span>{i.concepto}<div className="text-xs text-slate-500">{i.socio}</div></span>
                  <span className={i.estado !== "pendiente" ? "text-slate-400 line-through" : ""}>{pesos(i.total)}</span>
                </li>
              ))}
            </ul>
            <div className="mb-4 flex justify-between text-lg font-bold"><span>Total</span><span>{pesos(total)}</span></div>
            <Button className="w-full !bg-sky-500 hover:!bg-sky-600" disabled={total === 0} loading={estado === "pagando"} onClick={pagar}>
              {total === 0 ? "Ya está pagado" : "Pagar (simulado)"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export const esCheckoutDemo = () => window.location.pathname.endsWith("/demo-pago");
