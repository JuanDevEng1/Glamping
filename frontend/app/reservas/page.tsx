import type { Metadata } from "next";
import { obtenerConfiguracion } from "@lauburu/backend/db";
import { hoyEnBogota, trmParaCobro } from "@lauburu/backend/moneda";
import { clientePaypal } from "@lauburu/backend/paypal";
import { TIPOS_DOCUMENTO } from "@lauburu/backend/reservas";
import { FlujoReserva } from "@/components/reserva/FlujoReserva";
import { Proximamente } from "@/components/ui";

export const metadata: Metadata = {
  title: "Reservar",
  description:
    "Elige tus fechas en el calendario, mira el precio de cada noche y reserva Lauburu Glamping en Manizales.",
};

export default async function Reservas() {
  const [config, trm] = await Promise.all([obtenerConfiguracion(), trmParaCobro()]);

  if (!config) {
    return (
      <Proximamente
        overline="Reservas"
        titulo="Muy pronto podrás reservar en línea"
        texto="Estamos preparando el calendario con el precio de cada noche. Mientras tanto, escríbenos y te ayudamos a encontrar tu fecha."
        mensajeWhatsApp="Hola, quiero reservar en Lauburu Glamping"
      />
    );
  }

  return (
    <FlujoReserva
      config={{
        maxHuespedes: config.maxHuespedes,
        huespedesIncluidos: config.huespedesIncluidos,
        maxAdicionales: config.maxAdicionales,
        precioAdicionalAdulto: config.precioAdicionalAdulto,
        precioAdicionalNino: config.precioAdicionalNino,
        precioMascota: config.precioMascota,
        horaCheckin: config.horaCheckin,
        horaCheckout: config.horaCheckout,
        minutosHold: config.minutosHold,
      }}
      tiposDocumento={TIPOS_DOCUMENTO}
      trm={trm}
      hoy={hoyEnBogota()}
      paypal={trm ? clientePaypal() : null}
    />
  );
}
