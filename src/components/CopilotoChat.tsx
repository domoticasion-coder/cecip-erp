import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp, Bot, Check, Copy, Menu, MessageSquare, PanelLeftClose, Plus, RefreshCw, Sparkles, Trash2, type LucideIcon,
} from "lucide-react";
import { api } from "../lib/api";
import { supabase } from "../lib/supabase";
import { TextoIA } from "./TextoIA";
import { cx, useToast } from "./ui";

type Mensaje = { rol: "usuario" | "copiloto"; texto: string; error?: boolean };
type Chat = { id: string; titulo: string; updated_at: string };

export interface Sugerencia { icono: LucideIcon; titulo: string; detalle: string; pregunta: string }

export interface CopilotoChatProps {
  ambito: "portal" | "erp";
  nombre?: string;          // para el saludo
  intro: string;            // texto debajo del saludo
  sugerencias: Sugerencia[];
  aviso: string;            // nota al pie del cuadro de mensaje
  titulo?: string;
}

/** Copiloto CeCIP: chat con IA a pantalla completa (estilo ChatGPT) con historial de conversaciones.
 *  Lo usan el portal de socios y el ERP (cada uno con su historial y su contexto). */
export function CopilotoChat({ ambito, nombre, intro, sugerencias, aviso, titulo = "Copiloto CeCIP" }: CopilotoChatProps) {
  const toast = useToast();
  const qc = useQueryClient();
  const [chatId, setChatId] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const [animando, setAnimando] = useState<{ i: number; n: number } | null>(null);
  const [panel, setPanel] = useState(() => window.innerWidth >= 1024);
  const [copiado, setCopiado] = useState<number | null>(null);
  const finRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: chats } = useQuery({
    queryKey: ["copiloto-chats", ambito],
    queryFn: async () => {
      const { data } = await supabase.from("copiloto_chats").select("id, titulo, updated_at").eq("ambito", ambito)
        .order("updated_at", { ascending: false }).limit(50);
      return (data || []) as Chat[];
    },
  });

  // Efecto "escribiendo": la respuesta aparece de a poco
  useEffect(() => {
    if (!animando) return;
    const total = mensajes[animando.i]?.texto.length ?? 0;
    if (animando.n >= total) {
      setAnimando(null);
      return;
    }
    const t = setTimeout(() => setAnimando({ i: animando.i, n: Math.min(total, animando.n + Math.max(3, Math.round(total / 120))) }), 12);
    return () => clearTimeout(t);
  }, [animando, mensajes]);

  useEffect(() => {
    finRef.current?.scrollIntoView({ block: "end" });
  }, [mensajes.length, pensando, animando?.n]);

  // Ajuste automático de la altura del cuadro de texto
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [texto]);

  async function abrirChat(id: string) {
    if (pensando) return;
    const { data } = await supabase.from("copiloto_chats").select("id, mensajes").eq("id", id).single();
    setChatId(id);
    setMensajes(((data?.mensajes as Mensaje[]) || []).filter((m) => !m.error));
    setAnimando(null);
    if (window.innerWidth < 1024) setPanel(false);
  }

  function nuevoChat() {
    if (pensando) return;
    setChatId(null);
    setMensajes([]);
    setAnimando(null);
    setTexto("");
    if (window.innerWidth < 1024) setPanel(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function borrarChat(id: string) {
    if (!confirm("¿Borrar esta conversación?")) return;
    await supabase.from("copiloto_chats").delete().eq("id", id);
    if (id === chatId) nuevoChat();
    qc.invalidateQueries({ queryKey: ["copiloto-chats", ambito] });
  }

  async function guardar(id: string | null, lista: Mensaje[], primeraPregunta: string): Promise<string | null> {
    const limpios = lista.filter((m) => !m.error).slice(-100);
    if (id) {
      await supabase.from("copiloto_chats").update({ mensajes: limpios, updated_at: new Date().toISOString() }).eq("id", id);
      qc.invalidateQueries({ queryKey: ["copiloto-chats", ambito] });
      return id;
    }
    const titulo = primeraPregunta.length > 60 ? primeraPregunta.slice(0, 57) + "…" : primeraPregunta;
    const { data } = await supabase.from("copiloto_chats").insert({ titulo, mensajes: limpios, ambito }).select("id").single();
    qc.invalidateQueries({ queryKey: ["copiloto-chats", ambito] });
    return data?.id ?? null;
  }

  async function preguntar(pregunta: string, base: Mensaje[]) {
    const p = pregunta.trim();
    if (!p || pensando) return;
    const conPregunta: Mensaje[] = [...base, { rol: "usuario", texto: p }];
    setMensajes(conPregunta);
    setTexto("");
    setPensando(true);
    setAnimando(null);
    try {
      const historial = base.filter((m) => !m.error).map(({ rol, texto }) => ({ rol, texto }));
      const r = await api<{ respuesta: string }>("copilot", { pregunta: p, historial, ambito });
      const final: Mensaje[] = [...conPregunta, { rol: "copiloto", texto: r.respuesta }];
      setMensajes(final);
      setAnimando({ i: final.length - 1, n: 0 });
      const primera = final.find((m) => m.rol === "usuario")?.texto || p;
      const id = await guardar(chatId, final, primera);
      if (id) setChatId(id);
    } catch (e) {
      setMensajes([...conPregunta, { rol: "copiloto", texto: (e as Error).message, error: true }]);
    } finally {
      setPensando(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function regenerar() {
    // Vuelve a preguntar la última consulta del usuario
    const ultimaUsuario = [...mensajes].map((m, i) => ({ m, i })).reverse().find((x) => x.m.rol === "usuario");
    if (!ultimaUsuario) return;
    preguntar(ultimaUsuario.m.texto, mensajes.slice(0, ultimaUsuario.i));
  }

  async function copiar(i: number) {
    try {
      await navigator.clipboard.writeText(mensajes[i].texto);
      setCopiado(i);
      setTimeout(() => setCopiado(null), 1500);
    } catch {
      toast("No se pudo copiar.", "error");
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    preguntar(texto, mensajes);
  };

  const vacio = mensajes.length === 0;

  return (
    <div className="relative flex min-h-0 flex-1">
      {/* Barra lateral de conversaciones */}
      {panel && <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setPanel(false)} />}
      <aside className={cx(
        "z-30 flex w-72 shrink-0 flex-col border-r border-slate-200 bg-slate-50",
        panel ? "fixed inset-y-0 left-0 lg:static" : "hidden"
      )}>
        <div className="flex items-center gap-2 p-3">
          <button onClick={nuevoChat}
            className="flex flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-100">
            <Plus className="h-4 w-4" /> Nuevo chat
          </button>
          <button onClick={() => setPanel(false)} title="Ocultar historial" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
            <PanelLeftClose className="h-5 w-5" />
          </button>
        </div>
        <div className="px-4 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Conversaciones</div>
        <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {!chats?.length && <p className="px-2 py-3 text-xs text-slate-400">Todavía no hay conversaciones.</p>}
          {chats?.map((c) => (
            <div key={c.id} className={cx("group flex items-center rounded-lg", c.id === chatId ? "bg-slate-200" : "hover:bg-slate-100")}>
              <button onClick={() => abrirChat(c.id)} className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left text-sm text-slate-700">
                <MessageSquare className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="truncate">{c.titulo}</span>
              </button>
              <button onClick={() => borrarChat(c.id)} title="Borrar"
                className="mr-1 rounded p-1.5 text-slate-400 opacity-0 hover:text-red-600 group-hover:opacity-100">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="border-t border-slate-200 p-3 text-xs text-slate-400">Tus conversaciones son privadas: solo las ves vos.</div>
      </aside>

      {/* Conversación */}
      <section className="flex min-w-0 flex-1 flex-col bg-white">
        <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
          {!panel && (
            <button onClick={() => setPanel(true)} title="Ver conversaciones" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
              <Menu className="h-5 w-5" />
            </button>
          )}
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Sparkles className="h-4 w-4 text-brand-600" /> {titulo}
          </div>
          {!vacio && (
            <button onClick={nuevoChat} title="Nuevo chat" className="ml-auto rounded-lg p-2 text-slate-500 hover:bg-slate-100">
              <Plus className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {vacio ? (
            <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center px-4 py-10">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 text-white shadow-lg">
                <Sparkles className="h-8 w-8" />
              </div>
              <h1 className="text-center text-2xl font-bold text-slate-900 sm:text-3xl">
                {nombre ? `¡Hola, ${nombre}!` : "¡Hola!"} ¿En qué te ayudo hoy?
              </h1>
              <p className="mt-2 max-w-lg text-center text-sm text-slate-500">{intro}</p>
              <div className="mt-8 grid w-full gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {sugerencias.map((s) => (
                  <button key={s.titulo} onClick={() => preguntar(s.pregunta, [])}
                    className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 text-left transition hover:border-slate-300 hover:bg-slate-50">
                    <s.icono className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
                    <span>
                      <span className="block text-sm font-medium text-slate-800">{s.titulo}</span>
                      <span className="block text-xs text-slate-500">{s.detalle}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
              {mensajes.map((m, i) => {
                if (m.rol === "usuario") {
                  return (
                    <div key={i} className="flex justify-end">
                      <div className="max-w-[85%] whitespace-pre-wrap rounded-3xl bg-slate-100 px-4 py-2.5 text-[15px] text-slate-800">{m.texto}</div>
                    </div>
                  );
                }
                const visible = animando?.i === i ? m.texto.slice(0, animando.n) : m.texto;
                const esUltima = i === mensajes.length - 1;
                return (
                  <div key={i} className="flex gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-600 to-brand-800 text-white">
                      <Bot className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1 pt-1">
                      {m.error ? (
                        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">⚠️ {m.texto}</div>
                      ) : (
                        <TextoIA texto={visible} className="text-[15px] leading-relaxed text-slate-800" />
                      )}
                      {animando?.i !== i && (
                        <div className="mt-2 flex gap-1 text-slate-400">
                          {!m.error && (
                            <button onClick={() => copiar(i)} title="Copiar" className="rounded-md p-1.5 hover:bg-slate-100 hover:text-slate-600">
                              {copiado === i ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                            </button>
                          )}
                          {esUltima && !pensando && (
                            <button onClick={regenerar} title="Regenerar respuesta" className="rounded-md p-1.5 hover:bg-slate-100 hover:text-slate-600">
                              <RefreshCw className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {pensando && (
                <div className="flex gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-600 to-brand-800 text-white">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="flex items-center gap-1 pt-2.5">
                    {[0, 1, 2].map((d) => <span key={d} className="h-2 w-2 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${d * 150}ms` }} />)}
                  </div>
                </div>
              )}
              <div ref={finRef} />
            </div>
          )}
        </div>

        {/* Cuadro de mensaje */}
        <div className="px-3 pb-3 pt-1 sm:px-4">
          <form onSubmit={onSubmit}
            className="mx-auto flex max-w-3xl items-end gap-2 rounded-3xl border border-slate-300 bg-white p-2 pl-4 shadow-sm focus-within:border-brand-500">
            <textarea ref={inputRef} rows={1} value={texto} maxLength={ambito === "erp" ? 4000 : 1500} autoFocus
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); preguntar(texto, mensajes); } }}
              placeholder="Escribí tu mensaje al Copiloto…"
              className="max-h-[200px] flex-1 resize-none bg-transparent py-2 text-[15px] text-slate-800 outline-none placeholder:text-slate-400" />
            <button type="submit" disabled={!texto.trim() || pensando} title="Enviar"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-700 text-white transition hover:bg-brand-800 disabled:bg-slate-300">
              <ArrowUp className="h-5 w-5" />
            </button>
          </form>
          <p className="mx-auto mt-1.5 max-w-3xl text-center text-[11px] text-slate-400">
            {aviso}
          </p>
        </div>
      </section>
    </div>
  );
}
