import type { Metadata } from "next";
import { obtenerConfiguracion } from "@lauburu/backend/db";
import { Container } from "@/components/Container";
import { Checkout } from "@/components/servicios/Checkout";

export const metadata: Metadata = {
  title: "Finalizar compra",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function PagoServicios() {
  const config = await obtenerConfiguracion();
  return (
    <section aria-labelledby="pago-titulo" className="py-12 md:py-16">
      <Container>
        <p className="text-overline font-medium text-terracota-oscuro">SERVICIOS</p>
        <h1 id="pago-titulo" className="mt-2 font-serif text-h1 text-verde">
          Finaliza tu compra
        </h1>
        <div className="mt-8">
          <Checkout minutosHold={config?.minutosHold ?? 20} />
        </div>
      </Container>
    </section>
  );
}
