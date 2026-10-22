import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck, Clock, Info } from "lucide-react";
import { obtenerPedidoPublico } from "@lauburu/backend/pedidos";
import { Container } from "@/components/Container";
import { CopiarCodigo, RefrescoAutomatico } from "@/components/reserva/Confirmacion";

import { VaciarCarritoSiConfirmado } from "@/components/servicios/Checkout";
import { Tarjeta, claseBoton } from "@/components/ui";
import { cantidadTexto, cuandoTexto, formatoPrecio } from "@/lib/formato";
import { enlaceWhatsApp } from "@/lib/sitio";

// Solo muestra "confirmado" si la BD lo dice: el estado lo cambia únicamente el webhook.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tu pedido",
  robots: { index: false, follow: false },
};

export default async function PedidoServicios({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  const pedido = await obtenerPedidoPublico(codigo);
  if (!pedido) notFound();

  const confirmado = pedido.estado === "confirmado";
  const pendiente = pedido.estado === "pendiente";

  return (
    <section aria-labelledby="pedido-titulo" className="py-12 md:py-16">
      <Container>
        <VaciarCarritoSiConfirmado confirmado={confirmado} />
        <div className="mx-auto max-w-3xl space-y-6">
          <Tarjeta borde={confirmado ? "miel" : "niebla"} className="text-center">
            {confirmado ? (
              <CircleCheck size={48} strokeWidth={1.5} className="mx-auto text-verde" aria-hidden />
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
            <h1 id="pedido-titulo" className="mt-4 font-serif text-h1 text-verde">
              {confirmado
                ? `¡Pedido confirmado, ${pedido.nombre}!`
                : pendiente
                  ? "Estamos verificando tu pago"
                  : "Este pedido no se completó"}
            </h1>
            <p className="mx-auto mt-4 max-w-[65ch]">
              {confirmado
                ? `Te enviamos el detalle a ${pedido.correo} y avisamos a los aliados.`
                : pendiente
                  ? "En cuanto la pasarela apruebe el pago, esta página se actualiza sola."
                  : "El tiempo para pagar terminó o el pedido se canceló, y los cupos quedaron libres."}
            </p>
            {pendiente && <RefrescoAutomatico hasta={pedido.expiraEn} />}
            {!confirmado && !pendiente && (
              <Link href="/servicios" className={`${claseBoton("primario")} mt-6 w-full sm:w-auto`}>
                Volver a servicios
              </Link>
            )}
          </Tarjeta>

          <Tarjeta className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-overline font-medium text-terracota-oscuro">CÓDIGO DEL PEDIDO</p>
              <p className="mt-1 font-serif text-h2 text-verde">{pedido.codigo}</p>
              {pedido.reserva && (
                <p className="text-small">Vinculado a la reserva {pedido.reserva}</p>
              )}
            </div>
            <CopiarCodigo codigo={pedido.codigo} />
          </Tarjeta>

          <Tarjeta>
            <h2 className="font-serif text-h3 text-verde">Servicios</h2>
            <ul className="mt-4 divide-y divide-niebla">
              {pedido.items.map((item, i) => (
                <li key={i} className="flex items-baseline justify-between gap-4 py-3 text-small">
                  <span>
                    <Link
                      href={`/servicios/${item.slug}`}
                      className="font-medium text-verde underline-offset-4 hover:underline"
                    >
                      {item.nombre}
                    </Link>
                    <span className="block">
                      {cuandoTexto(item.fecha, item.turno)} ·{" "}
                      {cantidadTexto(item.cantidad, item.unidadPrecio)}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium text-verde">
                    {formatoPrecio(item.subtotal, "COP", null)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 flex items-baseline justify-between gap-4 border-t border-verde pt-3">
              <span className="font-medium text-verde">
                {confirmado ? "Total pagado" : "Total"}
              </span>
              <span className="text-h3 font-bold text-verde">
                {formatoPrecio(pedido.totalCop, "COP", null)}
              </span>
            </p>
          </Tarjeta>

          <p className="flex items-start gap-3 rounded-card border border-miel bg-blanco p-4 text-small">
            <Info size={20} strokeWidth={1.5} className="shrink-0 text-verde" aria-hidden />
            <span>
              ¿Dudas con tu pedido? Escríbenos por{" "}
              <a
                href={enlaceWhatsApp(`Hola, tengo una pregunta sobre mi pedido ${pedido.codigo}`)}
                target="_blank"
                rel="noopener noreferrer"
                className={claseBoton("texto")}
              >
                WhatsApp
              </a>
              .
            </span>
          </p>
        </div>
      </Container>
    </section>
  );
}
