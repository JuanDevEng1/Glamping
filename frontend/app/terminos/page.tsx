import type { Metadata } from "next";
import { Proximamente } from "@/components/ui";

export const metadata: Metadata = { title: "Términos y condiciones" };

// TODO(fase 6): términos, política de cancelación y tratamiento de datos (Ley 1581) reales.
export default function Terminos() {
  return (
    <Proximamente
      overline="Términos"
      titulo="Términos y condiciones"
      texto="Estamos terminando de redactar los términos, la política de cancelación y el tratamiento de datos. Si tienes dudas antes de reservar, escríbenos."
      mensajeWhatsApp="Hola, tengo una pregunta sobre los términos de reserva de Lauburu Glamping"
    />
  );
}
