"use client";

// Carrito de servicios (maqueta "carrito de compra.html"). Se guarda en el navegador
// por comodidad, pero precios, cupos y total los recalcula siempre el servidor.
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { CalendarDays, Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import type { EstadiaVinculada, ValidacionCarrito } from "@lauburu/backend/pedidos";
import type { UnidadPrecio } from "@lauburu/backend/servicios";
import { validarCarritoAccion } from "@/app/servicios/acciones";
import { Precio } from "@/components/Moneda";
import { FotoPendiente, claseBoton } from "@/components/ui";
import {
  cantidadTexto,
  cuandoTexto,
  formatoFechaCorta,
  problemaLinea,
  unidadSingular,
} from "@/lib/formato";

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

export type ItemGuardado = {
  servicioId: number;
  slug: string;
  nombre: string;
  unidadPrecio: UnidadPrecio;
  foto: string;
  fecha: string | null;
  turno: string | null;
  cantidad: number;
  maxPorPedido: number;
};

export type ReservaGuardada = EstadiaVinculada & { correo: string };

type Carrito = {
  items: ItemGuardado[];
  reserva: ReservaGuardada | null;
  abierto: boolean;
  agregar: (item: ItemGuardado) => void;
  cambiarCantidad: (indice: number, cantidad: number) => void;
  quitar: (indice: number) => void;
  vaciar: () => void;
  vincular: (reserva: ReservaGuardada | null) => void;
  abrir: () => void;
  cerrar: () => void;
};

const CLAVE = "lauburu-carrito";
const CarritoContexto = createContext<Carrito | null>(null);

export function useCarrito() {
  const c = useContext(CarritoContexto);
  if (!c) throw new Error("useCarrito debe usarse dentro de CarritoProvider");
  return c;
}

/** Datos de la reserva vinculada que se envían al servidor (él vuelve a verificarlos). */
export const vinculo = (r: ReservaGuardada | null) =>
  r ? { codigo: r.codigo, correo: r.correo } : null;

export const itemsParaServidor = (items: ItemGuardado[]) =>
  items.map(({ servicioId, fecha, turno, cantidad }) => ({ servicioId, fecha, turno, cantidad }));

export function CarritoProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ItemGuardado[]>([]);
  const [reserva, setReserva] = useState<ReservaGuardada | null>(null);
  const [abierto, setAbierto] = useState(false);
  const cargado = useRef(false);

  useEffect(() => {
    try {
      const guardado = JSON.parse(localStorage.getItem(CLAVE) ?? "null");
      if (Array.isArray(guardado?.items)) setItems(guardado.items);
      if (guardado?.reserva) setReserva(guardado.reserva);
    } catch {
      // Sin almacenamiento o datos dañados: carrito vacío.
    }
    cargado.current = true;
  }, []);

  useEffect(() => {
    if (!cargado.current) return;
    try {
      localStorage.setItem(CLAVE, JSON.stringify({ items, reserva }));
    } catch {}
  }, [items, reserva]);

  const agregar = useCallback((nuevo: ItemGuardado) => {
    setItems((actuales) => {
      const i = actuales.findIndex(
        (x) =>
          x.servicioId === nuevo.servicioId && x.fecha === nuevo.fecha && x.turno === nuevo.turno,
      );
      if (i === -1) return [...actuales, nuevo];
      return actuales.map((x, j) =>
        j === i ? { ...x, cantidad: Math.min(x.maxPorPedido, x.cantidad + nuevo.cantidad) } : x,
      );
    });
    setAbierto(true);
  }, []);

  // Funciones estables: se usan como dependencias de efectos (foco del panel, vaciar al confirmar).
  const cambiarCantidad = useCallback(
    (indice: number, cantidad: number) =>
      setItems((xs) =>
        xs.map((x, j) =>
          j === indice ? { ...x, cantidad: Math.max(1, Math.min(x.maxPorPedido, cantidad)) } : x,
        ),
      ),
    [],
  );
  const quitar = useCallback(
    (indice: number) => setItems((xs) => xs.filter((_, j) => j !== indice)),
    [],
  );
  const vaciar = useCallback(() => setItems((xs) => (xs.length ? [] : xs)), []);
  const abrir = useCallback(() => setAbierto(true), []);
  const cerrar = useCallback(() => setAbierto(false), []);

  const valor: Carrito = {
    items,
    reserva,
    abierto,
    agregar,
    cambiarCantidad,
    quitar,
    vaciar,
    vincular: setReserva,
    abrir,
    cerrar,
  };

  return (
    <CarritoContexto.Provider value={valor}>
      {children}
      <PanelCarrito />
    </CarritoContexto.Provider>
  );
}

// ---------------------------------------------------------------------------
// Botón del header
// ---------------------------------------------------------------------------

export function BotonCarrito({ className = "" }: { className?: string }) {
  const { items, abrir } = useCarrito();
  const total = items.length;
  return (
    <button
      type="button"
      onClick={abrir}
      aria-label={`Carrito de servicios, ${total} ${total === 1 ? "servicio" : "servicios"}`}
      className={`relative inline-flex size-11 items-center justify-center rounded-full transition-colors duration-200 hover:bg-verde-hoja ${className}`}
    >
      <ShoppingBag size={24} strokeWidth={1.5} aria-hidden />
      {total > 0 && (
        <span
          aria-hidden
          className="absolute top-0 right-0 inline-flex min-w-5 items-center justify-center rounded-full bg-crema px-1 text-xs font-bold text-verde"
        >
          {total}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Panel lateral
// ---------------------------------------------------------------------------

function PanelCarrito() {
  const { items, reserva, abierto, cerrar, cambiarCantidad, quitar, vincular } = useCarrito();
  const [validacion, setValidacion] = useState<ValidacionCarrito | null>(null);
  const [cargando, setCargando] = useState(false);
  const cerrarRef = useRef<HTMLButtonElement>(null);
  const anterior = useRef<Element | null>(null);

  // Validación en el servidor al abrir y en cada cambio.
  useEffect(() => {
    if (!abierto) return;
    if (items.length === 0) {
      setValidacion(null);
      return;
    }
    let vigente = true;
    setCargando(true);
    validarCarritoAccion(itemsParaServidor(items), vinculo(reserva))
      .then((v) => {
        if (!vigente) return;
        if (v.error === "reserva_invalida") vincular(null);
        setValidacion(v);
      })
      .catch(() => vigente && setValidacion(null))
      .finally(() => vigente && setCargando(false));
    return () => {
      vigente = false;
    };
  }, [abierto, items, reserva, vincular]);

  // Foco, Esc y bloqueo de scroll mientras está abierto.
  useEffect(() => {
    if (!abierto) return;
    anterior.current = document.activeElement;
    cerrarRef.current?.focus();
    const alPresionar = (e: KeyboardEvent) => e.key === "Escape" && cerrar();
    document.addEventListener("keydown", alPresionar);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", alPresionar);
      document.body.style.overflow = "";
      (anterior.current as HTMLElement | null)?.focus?.();
    };
  }, [abierto, cerrar]);

  if (!abierto) return null;

  const lineas = validacion?.lineas ?? [];
  const valido = !!validacion?.valido && lineas.length === items.length;

  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-verde/40" onClick={cerrar} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="carrito-titulo"
        className="absolute inset-y-0 right-0 flex w-full flex-col bg-crema shadow-soft sm:max-w-md"
      >
        <div className="flex items-center justify-between gap-4 border-b border-niebla px-4 py-4 sm:px-6">
          <div>
            <h2 id="carrito-titulo" className="font-serif text-h3 text-verde">
              Tu carrito de servicios
            </h2>
            <p className="text-small">
              {items.length === 0
                ? "Aún no has agregado servicios."
                : `${items.length} ${items.length === 1 ? "servicio" : "servicios"}`}
            </p>
          </div>
          <button
            ref={cerrarRef}
            type="button"
            onClick={cerrar}
            aria-label="Cerrar carrito"
            className="inline-flex size-11 items-center justify-center rounded-full text-verde hover:bg-verde-tinte"
          >
            <X size={24} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
          {reserva && (
            <div className="rounded-card border border-miel bg-blanco p-4 text-small">
              <p className="text-overline font-medium text-terracota-oscuro">RESERVA VINCULADA</p>
              <p className="mt-1 font-medium text-verde">{reserva.codigo}</p>
              <p>
                Del {formatoFechaCorta(reserva.llegada)} al {formatoFechaCorta(reserva.salida)} ·{" "}
                {reserva.huespedes} {reserva.huespedes === 1 ? "persona" : "personas"}
              </p>
            </div>
          )}

          {items.map((item, i) => {
            const linea = lineas[i];
            const problema = linea ? problemaLinea(linea.estado, linea.disponible) : null;
            return (
              <article
                key={`${item.servicioId}-${item.fecha}-${item.turno}`}
                className={`rounded-card border bg-blanco p-4 ${problema ? "border-terracota-oscuro" : "border-niebla"}`}
              >
                <div className="flex gap-4">
                  <FotoPendiente descripcion={item.foto} className="size-20 shrink-0 p-1 md:p-1" />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/servicios/${item.slug}`}
                      onClick={cerrar}
                      className="font-medium text-verde underline-offset-4 hover:underline"
                    >
                      {item.nombre}
                    </Link>
                    <p className="mt-1 flex items-center gap-1 text-small">
                      <CalendarDays
                        size={16}
                        strokeWidth={1.5}
                        className="shrink-0 text-verde"
                        aria-hidden
                      />
                      {cuandoTexto(item.fecha, item.turno)}
                    </p>
                    {linea?.estado === "ok" && (
                      <p className="mt-1 text-small">
                        <Precio cop={linea.precioUnitario} /> por{" "}
                        {unidadSingular(item.unidadPrecio)}
                      </p>
                    )}
                  </div>
                </div>

                {problema && (
                  <p role="alert" className="mt-3 text-small text-terracota-oscuro">
                    {problema}
                  </p>
                )}

                <div className="mt-3 flex items-center justify-between gap-4">
                  <div className="inline-flex items-center rounded-full border border-niebla">
                    <button
                      type="button"
                      onClick={() => cambiarCantidad(i, item.cantidad - 1)}
                      disabled={item.cantidad <= 1}
                      aria-label={`Quitar una ${unidadSingular(item.unidadPrecio)} de ${item.nombre}`}
                      className="inline-flex size-11 items-center justify-center rounded-full text-verde disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Minus size={16} strokeWidth={1.5} />
                    </button>
                    <span className="min-w-24 text-center text-small" aria-live="polite">
                      {cantidadTexto(item.cantidad, item.unidadPrecio)}
                    </span>
                    <button
                      type="button"
                      onClick={() => cambiarCantidad(i, item.cantidad + 1)}
                      disabled={item.cantidad >= item.maxPorPedido}
                      aria-label={`Agregar una ${unidadSingular(item.unidadPrecio)} a ${item.nombre}`}
                      className="inline-flex size-11 items-center justify-center rounded-full text-verde disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Plus size={16} strokeWidth={1.5} />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    {linea?.estado === "ok" && (
                      <span className="font-bold text-verde">
                        <Precio cop={linea.subtotal} />
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => quitar(i)}
                      aria-label={`Eliminar ${item.nombre} del carrito`}
                      className="inline-flex size-11 items-center justify-center rounded-full text-terracota-oscuro hover:bg-verde-tinte"
                    >
                      <Trash2 size={20} strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}

          {items.length === 0 && (
            <Link
              href="/servicios"
              onClick={cerrar}
              className={`${claseBoton("secundario")} w-full`}
            >
              Ver servicios
            </Link>
          )}
        </div>

        {items.length > 0 && (
          <div className="border-t border-niebla bg-blanco px-4 py-4 sm:px-6">
            <p className="flex items-baseline justify-between gap-4" aria-busy={cargando}>
              <span className="font-medium text-verde">Total</span>
              <span className="text-h3 font-bold text-verde">
                {validacion ? <Precio cop={validacion.total} /> : "…"}
              </span>
            </p>
            {validacion && !valido && !cargando && (
              <p className="mt-1 text-small text-terracota-oscuro">
                Revisa los servicios marcados para poder continuar.
              </p>
            )}
            <div className="mt-4 flex flex-col gap-2">
              {valido && !cargando ? (
                <Link
                  href="/servicios/pago"
                  onClick={cerrar}
                  className={`${claseBoton("primario")} w-full`}
                >
                  Ir a pagar
                </Link>
              ) : (
                <button type="button" disabled className={`${claseBoton("primario")} w-full`}>
                  Ir a pagar
                </button>
              )}
              <button
                type="button"
                onClick={cerrar}
                className={`${claseBoton("texto")} self-center py-2`}
              >
                Seguir explorando servicios
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
