"use client";

// Aviso "reserva vinculada" del catálogo. Vincular es opcional: con reserva, las fechas
// de los servicios se limitan a la estadía; sin ella se puede comprar cualquier fecha libre.
import { useState, useTransition } from "react";
import { CalendarCheck } from "lucide-react";
import { vincularReservaAccion } from "@/app/servicios/acciones";
import { claseBoton } from "@/components/ui";
import { formatoFechaCorta } from "@/lib/formato";
import { useCarrito } from "./Carrito";

const claseCampo =
  "h-12 w-full rounded-card border border-niebla bg-blanco px-4 text-base text-cafe outline-none focus:border-verde focus:ring-2 focus:ring-verde/20";

export function VincularReserva({ codigoInicial = "" }: { codigoInicial?: string }) {
  const { reserva, vincular } = useCarrito();
  const [abierto, setAbierto] = useState(!!codigoInicial);
  const [codigo, setCodigo] = useState(codigoInicial);
  const [correo, setCorreo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();

  if (reserva) {
    return (
      <div className="flex flex-col gap-4 rounded-card border border-miel bg-blanco p-5 sm:flex-row sm:items-center sm:justify-between md:p-6">
        <div className="flex items-start gap-3">
          <CalendarCheck size={24} strokeWidth={1.5} className="shrink-0 text-verde" aria-hidden />
          <p>
            Agregas servicios a tu reserva{" "}
            <strong className="font-medium text-verde">{reserva.codigo}</strong>, del{" "}
            {formatoFechaCorta(reserva.llegada)} al {formatoFechaCorta(reserva.salida)}. Te
            mostramos las fechas de tu estadía.
          </p>
        </div>
        <button
          type="button"
          onClick={() => vincular(null)}
          className={`${claseBoton("texto")} shrink-0`}
        >
          Desvincular
        </button>
      </div>
    );
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    iniciar(async () => {
      const r = await vincularReservaAccion(codigo, correo);
      if (r) {
        vincular({ ...r, correo: correo.trim().toLowerCase() });
        setAbierto(false);
      } else {
        setError("No encontramos una reserva confirmada con ese código y correo.");
      }
    });
  }

  return (
    <div className="rounded-card border border-niebla bg-blanco p-5 md:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-3">
          <CalendarCheck size={24} strokeWidth={1.5} className="shrink-0 text-verde" aria-hidden />
          <span>
            ¿Ya tienes una reserva? Vincúlala para ver las fechas de tu estadía. También puedes
            comprar sin reserva.
          </span>
        </p>
        {!abierto && (
          <button
            type="button"
            onClick={() => setAbierto(true)}
            className={`${claseBoton("secundario", "compacto")} shrink-0`}
          >
            Vincular reserva
          </button>
        )}
      </div>

      {abierto && (
        <form
          onSubmit={enviar}
          className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        >
          <div>
            <label htmlFor="vinculo-codigo" className="block text-small font-medium text-verde">
              Código de reserva
            </label>
            <input
              id="vinculo-codigo"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="LAU-XXXXXXXX"
              autoComplete="off"
              required
              className={`${claseCampo} mt-2 uppercase`}
            />
          </div>
          <div>
            <label htmlFor="vinculo-correo" className="block text-small font-medium text-verde">
              Correo de la reserva
            </label>
            <input
              id="vinculo-correo"
              type="email"
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
              autoComplete="email"
              required
              className={`${claseCampo} mt-2`}
            />
          </div>
          <button type="submit" disabled={enviando} className={claseBoton("secundario")}>
            {enviando ? "Buscando…" : "Vincular"}
          </button>
          {error && (
            <p role="alert" className="text-small text-terracota-oscuro sm:col-span-3">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
