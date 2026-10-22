import type { Metadata } from "next";
import Link from "next/link";
import { Clock, Store } from "lucide-react";
import { contarPorCategoria, listarServicios } from "@lauburu/backend/pedidos";
import { CATEGORIAS, UNIDADES_PRECIO, type Categoria } from "@lauburu/backend/servicios";
import { Container } from "@/components/Container";
import { Precio } from "@/components/Moneda";
import { VincularReserva } from "@/components/servicios/VincularReserva";
import { Chip, FotoPendiente, Proximamente, Tarjeta, claseBoton } from "@/components/ui";

export const metadata: Metadata = {
  title: "Servicios",
  description:
    "Tours, planes en fincas aliadas, gastronomía y transporte para complementar tu estadía en Lauburu Glamping.",
};

// Los cupos cambian con cada pedido.
export const dynamic = "force-dynamic";

export default async function Servicios({
  searchParams,
}: {
  searchParams: Promise<{ categoria?: string; reserva?: string }>;
}) {
  const params = await searchParams;
  const categoria =
    params.categoria && params.categoria in CATEGORIAS
      ? (params.categoria as Categoria)
      : undefined;
  const codigoReserva = /^LAU-[A-Z0-9]{8}$/i.test(params.reserva ?? "")
    ? params.reserva!.toUpperCase()
    : "";

  const [lista, conteo] = await Promise.all([listarServicios(categoria), contarPorCategoria()]);
  const total = Object.values(conteo).reduce((s, n) => s + (n ?? 0), 0);

  if (total === 0) {
    return (
      <Proximamente
        overline="Servicios"
        titulo="Tours y planes para tu estadía"
        texto="Estamos preparando el catálogo de experiencias con fincas aliadas de la zona. Escríbenos y te contamos qué puedes vivir durante tu visita."
        mensajeWhatsApp="Hola, quiero información sobre los servicios de Lauburu Glamping"
      />
    );
  }

  const filtros: { valor?: Categoria; texto: string; n: number }[] = [
    { texto: "Todos", n: total },
    ...(Object.keys(CATEGORIAS) as Categoria[])
      .filter((c) => conteo[c])
      .map((c) => ({ valor: c, texto: CATEGORIAS[c], n: conteo[c]! })),
  ];

  return (
    <section aria-labelledby="servicios-titulo" className="py-12 md:py-16">
      <Container>
        <p className="text-overline font-medium text-terracota-oscuro">SERVICIOS</p>
        <h1 id="servicios-titulo" className="mt-2 font-serif text-h1 text-verde">
          Servicios y experiencias
        </h1>
        <p className="mt-4 max-w-[65ch]">
          Complementa tu estadía con planes de fincas aliadas, gastronomía de la zona y transporte.
          Los pagas aquí mismo y te esperan en la fecha que elijas.
        </p>

        <div className="mt-8">
          <VincularReserva codigoInicial={codigoReserva} />
        </div>

        <nav aria-label="Categorías" className="mt-8">
          <ul className="flex flex-wrap gap-2">
            {filtros.map((f) => {
              const activo = f.valor === categoria;
              return (
                <li key={f.texto}>
                  <Link
                    href={f.valor ? `/servicios?categoria=${f.valor}` : "/servicios"}
                    aria-current={activo ? "page" : undefined}
                    className={`inline-flex h-11 items-center gap-2 rounded-full border px-4 text-small font-medium transition-colors duration-200 ${
                      activo
                        ? "border-verde bg-verde text-crema"
                        : "border-niebla bg-blanco text-verde hover:border-verde"
                    }`}
                  >
                    {f.texto} <span className={activo ? "opacity-85" : "text-cafe"}>{f.n}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <ul className="mt-8 grid gap-4 md:grid-cols-2 md:gap-6 lg:grid-cols-3">
          {lista.map((s) => (
            <li key={s.id}>
              <Tarjeta borde="miel" className="flex flex-col">
                <FotoPendiente descripcion={s.foto} className="aspect-[3/2]" />
                <div className="mt-4 flex items-center justify-between gap-2">
                  <p className="text-overline font-medium text-terracota-oscuro uppercase">
                    {CATEGORIAS[s.categoria]}
                  </p>
                  <Chip tipo={s.incluidoOExtra} />
                </div>
                <h2 className="mt-2 font-serif text-h3 text-verde">
                  <Link
                    href={`/servicios/${s.slug}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {s.nombre}
                  </Link>
                </h2>
                <p className="mt-2 text-small">{s.resumen}</p>
                <ul className="mt-3 space-y-1 text-small">
                  <li className="flex items-center gap-2">
                    <Store
                      size={16}
                      strokeWidth={1.5}
                      className="shrink-0 text-verde"
                      aria-hidden
                    />{" "}
                    {s.aliado}
                  </li>
                  {s.duracion && (
                    <li className="flex items-center gap-2">
                      <Clock
                        size={16}
                        strokeWidth={1.5}
                        className="shrink-0 text-verde"
                        aria-hidden
                      />{" "}
                      {s.duracion}
                    </li>
                  )}
                </ul>

                <div className="mt-auto flex flex-col gap-4 border-t border-niebla pt-4">
                  {s.incluidoOExtra === "incluido" ? (
                    <p className="font-medium text-verde">Incluido en tu estadía</p>
                  ) : (
                    <p>
                      <span className="text-h3 font-bold text-verde">
                        <Precio cop={s.precio} />
                      </span>{" "}
                      <span className="text-small">{UNIDADES_PRECIO[s.unidadPrecio]}</span>
                    </p>
                  )}
                  {!s.disponible && <p className="text-small">Sin cupos por ahora.</p>}
                  <Link
                    href={`/servicios/${s.slug}`}
                    className={`${claseBoton("secundario")} w-full`}
                  >
                    {s.incluidoOExtra === "incluido" ? "Ver detalle" : "Ver fechas y detalle"}
                  </Link>
                </div>
              </Tarjeta>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
