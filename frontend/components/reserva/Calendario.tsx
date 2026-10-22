"use client";

// Calendario de precios por noche (wireframe 1). Precios y disponibilidad vienen de
// /api/calendario: aquí no se calcula ningún precio. 1 mes en móvil, 2 en desktop.
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { diaSemana, sumarDias, type DiaCalendario } from "@lauburu/backend/precios";
import { useMoneda } from "@/components/Moneda";
import { formatoFechaDia, formatoMes, formatoPrecio, formatoPrecioCorto } from "@/lib/formato";

type Props = {
  hoy: string;
  llegada?: string;
  salida?: string;
  incluidos: number;
  trm: number | null;
  /** Cambia para forzar la recarga de disponibilidad (ej. tras un conflicto). */
  version: number;
  onCambio: (llegada: string | undefined, salida: string | undefined) => void;
};

const DIAS_SEMANA = ["L", "M", "M", "J", "V", "S", "D"];
/** Debe coincidir con MESES_CALENDARIO del backend. */
const MESES_ADELANTE = 18;

function sumarMeses(mes: string, n: number) {
  const [a = 0, m = 1] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 7);
}

const esDesktop = () =>
  typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;

export function Calendario({ hoy, llegada, salida, incluidos, trm, version, onCambio }: Props) {
  const { moneda } = useMoneda();
  const mesActual = hoy.slice(0, 7);
  const mesLimite = sumarMeses(mesActual, MESES_ADELANTE);
  const [mesInicio, setMesInicio] = useState((llegada ?? hoy).slice(0, 7));
  const [dias, setDias] = useState<Map<string, DiaCalendario>>(new Map());
  const [meses, setMeses] = useState<Record<string, "cargando" | "error" | "listo">>({});
  const [enfocada, setEnfocada] = useState(llegada ?? hoy);
  const botones = useRef(new Map<string, HTMLButtonElement>());
  const debeEnfocar = useRef(false);

  const visibles = [mesInicio, sumarMeses(mesInicio, 1)].filter((m) => m <= mesLimite);

  // Al cambiar la versión se descarta lo cargado (la disponibilidad cambió).
  useEffect(() => {
    setMeses({});
    setDias(new Map());
  }, [version]);

  useEffect(() => {
    for (const mes of [mesInicio, sumarMeses(mesInicio, 1)]) {
      if (mes > mesLimite || meses[mes]) continue;
      setMeses((m) => ({ ...m, [mes]: "cargando" }));
      fetch(`/api/calendario?mes=${mes}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then(({ dias: lista }: { dias: DiaCalendario[] }) => {
          setDias((prev) => {
            const nuevo = new Map(prev);
            for (const d of lista) nuevo.set(d.fecha, d);
            return nuevo;
          });
          setMeses((m) => ({ ...m, [mes]: "listo" }));
        })
        .catch(() => setMeses((m) => ({ ...m, [mes]: "error" })));
    }
  }, [mesInicio, mesLimite, meses]);

  useEffect(() => {
    if (!debeEnfocar.current) return;
    debeEnfocar.current = false;
    botones.current.get(enfocada)?.focus();
  }, [enfocada, mesInicio, dias]);

  /** ¿Todas las noches de `desde` a `hasta - 1` están disponibles? */
  function rangoLibre(desde: string, hasta: string) {
    for (let f = desde; f < hasta; f = sumarDias(f, 1)) {
      if (dias.get(f)?.estado !== "disponible") return false;
    }
    return true;
  }

  const esSalidaValida = (fecha: string) =>
    !!llegada && !salida && fecha > llegada && rangoLibre(llegada, fecha);

  function seleccionable(fecha: string) {
    const d = dias.get(fecha);
    if (!d || d.estado === "pasado") return false;
    return esSalidaValida(fecha) || d.estado === "disponible";
  }

  function elegir(fecha: string) {
    if (!seleccionable(fecha)) return;
    if (esSalidaValida(fecha)) onCambio(llegada, fecha);
    else onCambio(fecha, undefined);
  }

  function mover(fecha: string, n: number) {
    const destino = sumarDias(fecha, n);
    const mes = destino.slice(0, 7);
    if (mes < mesActual || mes > mesLimite) return;
    const ultimoVisible = esDesktop() ? (visibles[1] ?? mesInicio) : mesInicio;
    if (mes < mesInicio) setMesInicio(mes);
    else if (mes > ultimoVisible) setMesInicio(esDesktop() ? sumarMeses(mes, -1) : mes);
    debeEnfocar.current = true;
    setEnfocada(destino);
  }

  function alPresionar(e: React.KeyboardEvent, fecha: string) {
    const pasos: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    const paso = pasos[e.key];
    if (paso !== undefined) {
      e.preventDefault();
      mover(fecha, paso);
    }
  }

  function descripcion(d: DiaCalendario) {
    const fecha = formatoFechaDia(d.fecha);
    if (d.estado === "pasado") return `${fecha}, fecha pasada`;
    if (esSalidaValida(d.fecha) && d.estado !== "disponible")
      return `${fecha}, disponible como salida`;
    if (d.estado === "ocupado") return `${fecha}, ocupado`;
    if (d.estado === "bloqueado") return `${fecha}, no disponible`;
    const extras = [d.festivo && "festivo", d.mejorPrecio && "mejor precio"]
      .filter(Boolean)
      .join(", ");
    return `${fecha}, ${formatoPrecio(d.precio, moneda, trm)} por noche${extras ? `, ${extras}` : ""}`;
  }

  function etiqueta(d: DiaCalendario) {
    if (d.mejorPrecio) return "MÍN";
    if (d.festivo || d.tipo === "puente" || d.tipo === "festivo") return "Fest";
    if (d.tipo === "alta") return "FDS";
    if (d.tipo === "temporada") return "Temp";
    return null;
  }

  function renderMes(mes: string, className = "") {
    const primero = `${mes}-01`;
    const vacios = (diaSemana(primero) + 6) % 7;
    const [a = 0, m = 1] = mes.split("-").map(Number);
    const totalDias = new Date(Date.UTC(a, m, 0)).getUTCDate();
    const fechas = Array.from({ length: totalDias }, (_, i) => sumarDias(primero, i));
    const estado = meses[mes];

    return (
      <div key={mes} className={className}>
        <h3 className="text-center font-serif text-h3 text-verde first-letter:uppercase">
          {formatoMes(mes)}
        </h3>
        {estado === "error" ? (
          <p className="mt-6 text-center text-small text-terracota-oscuro">
            No pudimos cargar este mes. Intenta de nuevo en un momento.
          </p>
        ) : (
          <div
            role="grid"
            aria-label={formatoMes(mes)}
            aria-busy={estado !== "listo"}
            className="mt-4"
          >
            <div role="row" className="grid grid-cols-7 gap-1">
              {DIAS_SEMANA.map((d, i) => (
                <span
                  key={i}
                  role="columnheader"
                  className="text-center text-xs font-medium text-verde"
                >
                  {d}
                </span>
              ))}
            </div>
            <div role="row" className="mt-2 grid grid-cols-7 gap-1">
              {Array.from({ length: vacios }, (_, i) => (
                <span key={`v${i}`} aria-hidden />
              ))}
              {fechas.map((fecha) => {
                const d = dias.get(fecha);
                const esLlegada = fecha === llegada;
                const esSalida = fecha === salida;
                const enRango = !!llegada && !!salida && fecha > llegada && fecha < salida;
                const activo = seleccionable(fecha);
                const disponible = d?.estado === "disponible";
                const tag = d && disponible ? etiqueta(d) : null;

                let estilo = "border border-niebla bg-blanco text-cafe hover:border-verde";
                if (!d || d.estado === "pasado") estilo = "text-cafe opacity-40";
                else if (!disponible && !activo) estilo = "bg-niebla text-cafe opacity-60";
                if (enRango) estilo = "bg-verde-tinte text-verde";
                if (esLlegada || esSalida) estilo = "bg-verde text-crema";

                return (
                  <button
                    key={fecha}
                    ref={(el) => {
                      if (el) botones.current.set(fecha, el);
                      else botones.current.delete(fecha);
                    }}
                    type="button"
                    role="gridcell"
                    tabIndex={fecha === enfocada ? 0 : -1}
                    aria-disabled={!activo}
                    aria-selected={esLlegada || esSalida || enRango}
                    aria-label={d ? descripcion(d) : formatoFechaDia(fecha)}
                    onClick={() => elegir(fecha)}
                    onFocus={() => setEnfocada(fecha)}
                    onKeyDown={(e) => alPresionar(e, fecha)}
                    className={`flex h-14 flex-col items-center justify-center gap-0.5 rounded-sm text-small transition-colors duration-200 sm:h-16 ${estilo} ${activo ? "cursor-pointer" : "cursor-not-allowed"}`}
                  >
                    <span className="font-medium leading-none">{Number(fecha.slice(8))}</span>
                    {d && disponible && (
                      <span
                        className={`text-xs leading-none ${d.mejorPrecio && !esLlegada && !esSalida ? "font-bold text-verde" : ""}`}
                      >
                        {formatoPrecioCorto(d.precio, moneda, trm)}
                      </span>
                    )}
                    {d?.estado === "ocupado" && <span className="text-xs leading-none">Ocup.</span>}
                    {tag && <span className="hidden text-xs leading-none sm:block">{tag}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  const botonMes =
    "inline-flex size-11 items-center justify-center rounded-full border-[1.5px] border-verde text-verde transition-colors duration-200 hover:bg-verde hover:text-crema disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-verde";

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => setMesInicio(sumarMeses(mesInicio, -1))}
          disabled={mesInicio <= mesActual}
          className={botonMes}
          aria-label="Mes anterior"
        >
          <ChevronLeft size={20} strokeWidth={1.5} />
        </button>
        <p className="text-center text-small">Precio por noche para {incluidos} personas</p>
        <button
          type="button"
          onClick={() => setMesInicio(sumarMeses(mesInicio, 1))}
          disabled={mesInicio >= mesLimite}
          className={botonMes}
          aria-label="Mes siguiente"
        >
          <ChevronRight size={20} strokeWidth={1.5} />
        </button>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        {visibles.map((mes, i) => renderMes(mes, i === 1 ? "hidden lg:block" : ""))}
      </div>

      <ul
        className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-small"
        aria-label="Convenciones del calendario"
      >
        <li className="flex items-center gap-2">
          <span className="size-4 rounded-sm border border-niebla bg-blanco" aria-hidden />{" "}
          Disponible
        </li>
        <li className="flex items-center gap-2">
          <span className="text-xs font-bold text-verde" aria-hidden>
            MÍN
          </span>{" "}
          Mejor precio
        </li>
        <li className="flex items-center gap-2">
          <span className="text-xs" aria-hidden>
            FDS · Fest
          </span>{" "}
          Fin de semana o festivo
        </li>
        <li className="flex items-center gap-2">
          <span className="size-4 rounded-sm bg-niebla opacity-60" aria-hidden /> Ocupado
        </li>
        <li className="flex items-center gap-2">
          <span className="size-4 rounded-sm bg-verde" aria-hidden /> Tu selección
        </li>
      </ul>
    </div>
  );
}
