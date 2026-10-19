import { AlertCircle, BarChart3, GraduationCap, HelpCircle, Mail, MessageCircle, Receipt, Sparkles, Store, Wallet } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { CopilotoChat, type Sugerencia } from "../../components/CopilotoChat";

const INTERNAS: Sugerencia[] = [
  { icono: BarChart3, titulo: "Resumen de la gestión", detalle: "socios, deuda y cobranza del mes", pregunta: "Haceme un resumen de la situación actual: socios, deuda, cobranza del mes y lo que requiere atención." },
  { icono: AlertCircle, titulo: "¿Quiénes deben más?", detalle: "socios con deuda vencida", pregunta: "¿Cuáles son los 10 socios con más deuda vencida y cómo los contacto?" },
  { icono: Mail, titulo: "Redactar un recordatorio", detalle: "email o WhatsApp de cuota vencida", pregunta: "Redactame un mensaje de WhatsApp cordial para recordar una cuota vencida, con las variables {{nombre}} y {{deuda}}." },
  { icono: GraduationCap, titulo: "Capacitaciones", detalle: "inscriptos, cobros y docentes", pregunta: "¿Cómo vienen las capacitaciones: inscriptos, lo recaudado, lo que falta cobrar y lo que hay que pagar a los docentes?" },
  { icono: Receipt, titulo: "Facturación y banco", detalle: "facturas con error y conciliación", pregunta: "¿Hay facturas con error, movimientos del banco sin conciliar o alquileres vencidos?" },
  { icono: HelpCircle, titulo: "¿Cómo hago…?", detalle: "ayuda con el sistema", pregunta: "¿Cómo genero las cuotas del mes y cómo funcionan las formas de pago bimestral, semestral y anual?" },
];

const COMERCIA: Sugerencia[] = [
  { icono: Store, titulo: "Consultas de socios", detalle: "últimos pedidos a ComercIA", pregunta: "¿Qué consultas de socios entraron a ComercIA últimamente y cuáles están nuevas?" },
  { icono: MessageCircle, titulo: "Mensaje de difusión", detalle: "WhatsApp para comercios", pregunta: "Redactame un mensaje de WhatsApp breve para invitar a los comercios socios a sumarse a ComercIA, con {{nombre}}." },
  { icono: Sparkles, titulo: "Resumen del convenio", detalle: "qué ofrece ComercIA", pregunta: "Resumime en 5 puntos qué ofrece el convenio ComercIA a los comercios socios." },
  { icono: Wallet, titulo: "Promociones vigentes", detalle: "para comunicar", pregunta: "¿Qué promociones de ComercIA están vigentes y hasta cuándo?" },
];

/** Copiloto CeCIP del ERP: chat con IA para el personal, con los datos de gestión que permite su rol */
export default function Copiloto() {
  const { staff } = useAuth();
  const esComercia = staff?.rol === "comercia";
  return (
    <CopilotoChat
      ambito="erp"
      nombre={staff?.nombre?.split(" ")[0]}
      intro={esComercia
        ? "Soy el Copiloto CeCIP. Te ayudo con ComercIA: consultas de socios, promociones, convenio y redacción de difusiones."
        : "Soy el Copiloto CeCIP del ERP. Preguntame por socios, deudas, cobranza, tesorería, facturación, alquileres, eventos, capacitaciones o cómo hacer algo en el sistema. También redacto emails y mensajes."}
      sugerencias={esComercia ? COMERCIA : INTERNAS}
      aviso="El Copiloto usa IA (Gemini) con los datos actuales del sistema y puede equivocarse: verificá los montos importantes antes de usarlos."
    />
  );
}
