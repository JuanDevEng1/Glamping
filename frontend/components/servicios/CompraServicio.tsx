"use client";

// Tarjeta de compra y galería del detalle de un servicio (maqueta servicio.html).
// Los cupos vienen del servidor; al pagar, el servidor vuelve a validar precio y cupos.
import { useEffect, useState } from "react";
import { Minus, Plus, ShieldCheck, ShoppingBag } from "lucide-react";
import type { FechaDisponible, ServicioDetalle } from "@lauburu/backend/pedidos";
import { UNIDADES_PRECIO } from "@lauburu/backend/servicios";
import { fechasEnEstadiaAccion } from "@/app/servicios/acciones";
import { Precio } from "@/components/Moneda";
import { FotoPendiente, claseBoton } from "@/components/ui";
import { cantidadTexto, formatoFechaDia, formatoHora } from "@/lib/formato";
import { useCarrito, vinculo } from "./Carrito";

export function GaleriaServicio({ fotos }: { fotos: string[] }) {
  const [activa, setActiva] = useState(0);
  if (fotos.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <FotoPendiente bloque descripcion={fotos[activa]!} className="aspect-[3/2]" />
      {fotos.length > 1 && (
        <div className="grid grid-cols-4 gap-2" role="group" aria-label="Más fotos">
          {fotos.map((foto, i) => (
            <button
              key={foto}
              type="button"
              aria-pressed={i === activa}
              aria-label={`Ver foto: ${foto}`}
              onClick={() => setActiva(i)}
              className={`rounded-card border-2 transition-colors duration-200 ${i === activa ? "border-verde" : "border-transparent hover:border-niebla"}`}
            >
              <FotoPendiente descripcion={foto} className="aspect-[4/3] p-1 md:p-1" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type Props = {
  servicio: Pick<
    ServicioDetalle,
    | "id"
    | "slug"
    | "nombre"
    | "precio"
    | "unidadPrecio"
    | "tipoStock"
    | "maxPorPedido"
    | "incluidoOExtra"
    | "turnos"
    | "fotos"
  >;
  fechasIniciales: FechaDisponible[];
  unidadesIniciales: number | null;
};

const claseOpcion =
  "flex min-h-12 cursor-pointer items-center justify-between gap-4 rounded-card border border-niebla bg-blanco px-4 py-3 transition-colors duration-200 has-[:checked]:border-2 has-[:checked]:border-verde";

export function CompraServicio({ servicio, fechasIniciales, unidadesIniciales }: Props) {
  const { reserva, agregar, vincular } = useCarrito();
  const [fechas, setFechas] = useState(fechasIniciales);
  const [unidades, setUnidades] = useState(unidadesIniciales);
  const [fecha, setFecha] = useState<string | null>(null);
  const [turno, setTurno] = useState<string | null>(null);
  const [cantidad, setCantidad] = useState(1);
  const [verTodas, setVerTodas] = useState(false);

  // Con reserva vinculada, solo fechas dentro de la estadía (el servidor verifica código y correo).
  useEffect(() => {
    if (!reserva) {
      setFechas(fechasIniciales);
      setUnidades(unidadesIniciales);
      return;
    }
    let vigente = true;
    fechasEnEstadiaAccion(servicio.slug, vinculo(reserva)!).then((r) => {
      if (!vigente) return;
      if (!r) return vincular(null);
      // Límite de peticiones: se conservan las fechas que ya había.
      if ("error" in r) return;
      setFechas(r.fechas);
      setUnidades(r.unidadesLibres);
    });
    return () => {
      vigente = false;
    };
  }, [reserva, servicio.slug, fechasIniciales, unidadesIniciales, vincular]);

  // Al cambiar las fechas disponibles se reinicia la selección.
  useEffect(() => {
    setFecha(null);
    setTurno(null);
    setCantidad(1);
  }, [fechas]);

  if (servicio.incluidoOExtra === "incluido") {
    return (
      <div className="rounded-block border border-niebla bg-blanco p-5 md:p-6">
        <p className="font-serif text-h3 text-verde">Incluido en tu estadía</p>
        <p className="mt-2">No tienes que agregarlo al carrito: te lo damos durante tu visita.</p>
      </div>
    );
  }

  const dia = fechas.find((f) => f.fecha === fecha);
  const opcionTurno =
    dia?.turnos.find((t) => t.turno === turno) ??
    (dia && servicio.turnos.length === 0 ? dia.turnos[0] : undefined);
  const libres = servicio.tipoStock === "unidades" ? (unidades ?? 0) : (opcionTurno?.libres ?? 0);
  const maximo = Math.max(1, Math.min(servicio.maxPorPedido, libres));
  const listo = servicio.tipoStock === "unidades" ? libres > 0 : !!opcionTurno;
  const visibles = verTodas ? fechas : fechas.slice(0, 6);
  const unidad = UNIDADES_PRECIO[servicio.unidadPrecio];

  function agregarAlCarrito(e: React.FormEvent) {
    e.preventDefault();
    if (!listo) return;
    agregar({
      servicioId: servicio.id,
      slug: servicio.slug,
      nombre: servicio.nombre,
      unidadPrecio: servicio.unidadPrecio,
      foto: servicio.fotos[0] ?? servicio.nombre,
      fecha: servicio.tipoStock === "cupos" ? fecha : null,
      turno: servicio.turnos.length > 0 ? turno : null,
      cantidad: Math.min(cantidad, maximo),
      maxPorPedido: servicio.maxPorPedido,
    });
  }

  return (
    <form
      onSubmit={agregarAlCarrito}
      className="flex flex-col gap-6 rounded-block border border-niebla bg-blanco p-5 md:p-6"
    >
      <h2 id="compra-titulo" className="sr-only">
        Agregar al carrito
      </h2>
      <p className="border-b border-niebla pb-4">
        <span className="text-h2 font-bold text-verde">
          <Precio cop={servicio.precio} />
        </span>{" "}
        <span className="text-small">{unidad}</span>
      </p>

      {servicio.tipoStock === "cupos" ? (
        fechas.length === 0 ? (
          <p>
            {reserva
              ? "No quedan cupos durante tu estadía."
              : "No hay cupos disponibles en las próximas semanas."}
          </p>
        ) : (
          <>
            <fieldset>
              <legend className="text-small font-medium text-verde">
                {reserva ? "Fecha (dentro de tu estadía)" : "Fecha"}
              </legend>
              <div className="mt-2 flex flex-col gap-2">
                {visibles.map((f) => {
                  const total = f.turnos.reduce((s, t) => s + t.libres, 0);
                  return (
                    <label key={f.fecha} className={claseOpcion}>
                      <span className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="fecha"
                          value={f.fecha}
                          checked={fecha === f.fecha}
                          onChange={() => {
                            setFecha(f.fecha);
                            setTurno(null);
                            setCantidad(1);
                          }}
                          className="size-5 accent-verde"
                        />
                        <span className="first-letter:uppercase">{formatoFechaDia(f.fecha)}</span>
                      </span>
                      <span className="text-small">
                        {total} {total === 1 ? "cupo" : "cupos"}
                      </span>
                    </label>
                  );
                })}
              </div>
              {fechas.length > 6 && (
                <button
                  type="button"
                  onClick={() => setVerTodas((v) => !v)}
                  className={`${claseBoton("texto")} mt-2`}
                >
                  {verTodas ? "Ver menos fechas" : `Ver más fechas (${fechas.length - 6})`}
                </button>
              )}
            </fieldset>

            {dia && servicio.turnos.length > 0 && (
              <fieldset>
                <legend className="text-small font-medium text-verde">Turno</legend>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {dia.turnos.map((t) => (
                    <label key={t.turno} className={`${claseOpcion} justify-center`}>
                      <input
                        type="radio"
                        name="turno"
                        value={t.turno ?? ""}
                        checked={turno === t.turno}
                        onChange={() => {
                          setTurno(t.turno);
                          setCantidad(1);
                        }}
                        className="size-5 accent-verde"
                      />
                      <span>{t.turno ? formatoHora(t.turno) : "Sin turno"}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </>
        )
      ) : (
        <p className="text-small">
          {libres > 0
            ? `${libres} disponibles. Coordinamos contigo la entrega durante tu estadía.`
            : "Agotado por ahora."}
        </p>
      )}

      {listo && (
        <>
          <div>
            <div className="flex items-baseline justify-between gap-4">
              <span id="etiqueta-cantidad" className="text-small font-medium text-verde">
                Cantidad
              </span>
              <span className="text-small">Máximo {maximo}</span>
            </div>
            <div
              role="group"
              aria-labelledby="etiqueta-cantidad"
              className="mt-2 flex items-center justify-between rounded-card border border-niebla p-1"
            >
              <button
                type="button"
                onClick={() => setCantidad((c) => Math.max(1, c - 1))}
                disabled={cantidad <= 1}
                aria-label="Quitar uno"
                className="inline-flex size-11 items-center justify-center rounded-full text-verde transition-colors duration-200 hover:bg-verde-tinte disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Minus size={20} strokeWidth={1.5} />
              </button>
              <output aria-live="polite" className="font-medium text-verde">
                {cantidadTexto(cantidad, servicio.unidadPrecio)}
              </output>
              <button
                type="button"
                onClick={() => setCantidad((c) => Math.min(maximo, c + 1))}
                disabled={cantidad >= maximo}
                aria-label="Agregar uno"
                className="inline-flex size-11 items-center justify-center rounded-full text-verde transition-colors duration-200 hover:bg-verde-tinte disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus size={20} strokeWidth={1.5} />
              </button>
            </div>
          </div>

          <p className="flex justify-between gap-4 rounded-card bg-crema p-4 font-medium text-verde">
            <span>Subtotal</span>
            <Precio cop={servicio.precio * cantidad} />
          </p>
        </>
      )}

      <div className="flex flex-col gap-4">
        <button type="submit" disabled={!listo} className={`${claseBoton("primario")} w-full`}>
          <ShoppingBag size={20} strokeWidth={1.5} aria-hidden /> Agregar al carrito
        </button>
        {servicio.tipoStock === "cupos" && !listo && fechas.length > 0 && (
          <p className="text-small">Elige {dia ? "un turno" : "una fecha"} para continuar.</p>
        )}
        <p className="flex items-start gap-2 text-small">
          <ShieldCheck
            size={16}
            strokeWidth={1.5}
            className="mt-1 shrink-0 text-verde"
            aria-hidden
          />
          Todavía no te cobramos nada. Pagas al finalizar tu carrito.
        </p>
      </div>
    </form>
  );
}
