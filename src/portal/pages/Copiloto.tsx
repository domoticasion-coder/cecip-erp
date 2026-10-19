import { CalendarDays, CreditCard, Gift, MapPin, Store, Wallet } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { CopilotoChat, type Sugerencia } from "../../components/CopilotoChat";

const SUGERENCIAS: Sugerencia[] = [
  { icono: Wallet, titulo: "¿Cuánto debo?", detalle: "y cuándo vencen mis cuotas", pregunta: "¿Cuánto debo y cuándo vencen mis cuotas?" },
  { icono: CreditCard, titulo: "¿Cómo pago la cuota?", detalle: "Mercado Pago o transferencia", pregunta: "¿Cómo pago la cuota?" },
  { icono: Gift, titulo: "Beneficios para socios", detalle: "asesoramiento, convenios y más", pregunta: "¿Qué beneficios tengo como socio del CeCIP?" },
  { icono: Store, titulo: "¿Qué me ofrece ComercIA?", detalle: "ofertas para mi comercio e IEC", pregunta: "¿Qué me ofrece ComercIA para mi comercio?" },
  { icono: CalendarDays, titulo: "Próximas capacitaciones", detalle: "eventos y cursos", pregunta: "¿Qué eventos y capacitaciones hay próximamente?" },
  { icono: MapPin, titulo: "Sede y horarios", detalle: "dirección y contacto del CeCIP", pregunta: "¿Dónde queda la sede del CeCIP y en qué horario atienden?" },
];

/** Copiloto CeCIP del portal de socios */
export default function Copiloto() {
  const { socioUsuario } = useAuth();
  return (
    <CopilotoChat
      ambito="portal"
      nombre={socioUsuario?.nombre?.split(" ")[0]}
      intro="Soy el Copiloto del Centro Comercial e Industrial de Paraná. Preguntame por tu cuenta, cuotas y pagos, beneficios, eventos, ComercIA o cualquier tema del CeCIP."
      sugerencias={SUGERENCIAS}
      aviso="El Copiloto usa IA y puede equivocarse. Para trámites importantes confirmá con la administración del CeCIP."
    />
  );
}
