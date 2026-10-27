import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck, Clock, Home, Info, MapPin, PlusCircle } from "lucide-react";
import { obtenerConfiguracion } from "@lauburu/backend/db";
import { obtenerReservaPublica } from "@lauburu/backend/reservas";
import { detalleAdicionales, diasEntre, textoPersonas } from "@lauburu/backend/precios";
import { Container } from "@/components/Container";
import {
  CopiarCodigo,
  RefrescoAutomatico,
  SubirDocumento,
} from "@/components/reserva/Confirmacion";
import { PasosReserva } from "@/components/reserva/FlujoReserva";
import { FotoPendiente, Tarjeta, claseBoton } from "@/components/ui";
import { formatoFecha, formatoHora, formatoPrecio } from "@/lib/formato";
import { enlaceWhatsApp } from "@/lib/sitio";

// Paso 5. Solo muestra "confirmada" si la BD lo dice: el estado lo cambia únicamente el
// webhook de la pasarela, nunca esta página ni la página de retorno.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tu reserva",
  robots: { index: false, follow: false },
};

export default async function ConfirmacionReserva({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = await params;
  const [reserva, config] = await Promise.all([
    obtenerReservaPublica(codigo),
    obtenerConfiguracion(),
  ]);
  if (!reserva) notFound();

  const noches = diasEntre(reserva.fechaLlegada, reserva.fechaSalida);
  const confirmada = reserva.estado === "confirmada";
  const pendiente = reserva.estado === "pendiente";

  return (
    <section aria-labelledby="confirmacion-titulo" className="py-12 md:py-16">
      <Container>
        <div className="overflow-x-auto">
          <PasosReserva actual={confirmada ? 6 : 5} />
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-12 lg:items-start">
          <div className="space-y-6 lg:col-span-8">
            {/* Estado */}
            <Tarjeta borde={confirmada ? "miel" : "niebla"} className="text-center">
              {confirmada ? (
                <CircleCheck
                  size={48}
                  strokeWidth={1.5}
                  className="mx-auto text-verde"
                  aria-hidden
                />
              ) : pendiente ? (
                <Clock size={48} strokeWidth={1.5} className="mx-auto text-verde" aria-hidden />
              ) : (
                <Info
                  size={48}
                  strokeWidth={1.5}
                  className="mx-auto text-terracota-oscuro"
                  aria-hidden
                />
              )}
              <h1 id="confirmacion-titulo" className="mt-4 font-serif text-h1 text-verde">
                {confirmada
                  ? `¡Reserva confirmada, ${reserva.nombre}!`
                  : pendiente
                    ? "Estamos verificando tu pago"
                    : "Esta reserva no se completó"}
              </h1>
              <p className="mx-auto mt-4 max-w-[65ch]">
                {confirmada
                  ? `Te enviamos la confirmación y los términos a ${reserva.correo}.`
                  : pendiente
                    ? "En cuanto la pasarela apruebe el pago, esta página se actualiza sola. No necesitas pagar de nuevo."
                    : "El tiempo para pagar terminó o la reserva se canceló, y las fechas quedaron libres."}
              </p>
              {pendiente && <RefrescoAutomatico hasta={reserva.expiraEn} />}
              {!confirmada && !pendiente && (
                <Link
                  href="/reservas"
                  className={`${claseBoton("primario")} mt-6 w-full sm:w-auto`}
                >
                  Elegir nuevas fechas
                </Link>
              )}
            </Tarjeta>

            {/* Código */}
            <Tarjeta className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-overline font-medium text-terracota-oscuro">CÓDIGO DE RESERVA</p>
                <p className="mt-1 font-serif text-h2 text-verde">{reserva.codigo}</p>
              </div>
              <CopiarCodigo codigo={reserva.codigo} />
            </Tarjeta>

            {confirmada && (
              <SubirDocumento codigo={reserva.codigo} recibido={reserva.documentoRecibido} />
            )}

            {/* Resumen */}
            <Tarjeta>
              <h2 className="font-serif text-h3 text-verde">Resumen de la reserva</h2>
              <div className="mt-4 grid gap-6 sm:grid-cols-3">
                <FotoPendiente descripcion="Vista del glamping" className="aspect-[3/2]" />
                <dl className="grid gap-4 text-small sm:col-span-2 sm:grid-cols-2">
                  <div>
                    <dt className="font-medium text-verde">Fechas</dt>
                    <dd>
                      Del {formatoFecha(reserva.fechaLlegada)} al{" "}
                      {formatoFecha(reserva.fechaSalida)}
                    </dd>
                    <dd>
                      {noches} {noches === 1 ? "noche" : "noches"}
                    </dd>
                  </div>
                  {config && (
                    <div>
                      <dt className="font-medium text-verde">Horarios</dt>
                      <dd>Entrada (check-in) desde las {formatoHora(config.horaCheckin)}</dd>
                      <dd>Salida (check-out) hasta las {formatoHora(config.horaCheckout)}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="font-medium text-verde">Huéspedes</dt>
                    <dd>{textoPersonas(reserva.huespedes, reserva.adicionales)}</dd>
                    {detalleAdicionales(reserva.adicionales).length > 0 && (
                      <dd className="text-xs">
                        Adicionales: {detalleAdicionales(reserva.adicionales).join(", ")}
                      </dd>
                    )}
                    {reserva.mascotas > 0 && (
                      <dd className="text-xs">
                        {reserva.mascotas} {reserva.mascotas === 1 ? "mascota" : "mascotas"}
                      </dd>
                    )}
                  </div>
                  <div>
                    <dt className="font-medium text-verde">
                      {confirmada ? "Valor pagado" : "Valor de la reserva"}
                    </dt>
                    <dd className="font-bold text-verde">
                      {formatoPrecio(reserva.totalCop, "COP", null)}
                    </dd>
                  </div>
                </dl>
              </div>
            </Tarjeta>
          </div>

          {/* Acciones */}
          <aside className="space-y-6 lg:col-span-4">
            <Tarjeta>
              <h2 className="font-serif text-h3 text-verde">¿Qué sigue?</h2>
              <div className="mt-4 flex flex-col gap-3">
                <Link href="/#como-llegar" className={`${claseBoton("secundario")} w-full`}>
                  <MapPin size={20} strokeWidth={1.5} aria-hidden /> Cómo llegar
                </Link>
                {confirmada && (
                  <Link
                    href={`/servicios?reserva=${reserva.codigo}`}
                    className={`${claseBoton("secundario")} w-full`}
                  >
                    <PlusCircle size={20} strokeWidth={1.5} aria-hidden /> Agregar servicios
                  </Link>
                )}
                <Link href="/" className={`${claseBoton("secundario")} w-full`}>
                  <Home size={20} strokeWidth={1.5} aria-hidden /> Volver al inicio
                </Link>
              </div>
            </Tarjeta>
            <p className="flex items-start gap-3 rounded-card border border-miel bg-blanco p-4 text-small">
              <Info size={20} strokeWidth={1.5} className="shrink-0 text-verde" aria-hidden />
              <span>
                Si no ves nuestro correo, revisa la carpeta de spam. ¿Dudas? Escríbenos por{" "}
                <a
                  href={enlaceWhatsApp(
                    `Hola, tengo una pregunta sobre mi reserva ${reserva.codigo}`,
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={claseBoton("texto")}
                >
                  WhatsApp
                </a>
                .
              </span>
            </p>
          </aside>
        </div>
      </Container>
    </section>
  );
}
