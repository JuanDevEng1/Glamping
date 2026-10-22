import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, Clock, Info, MapPin, Mountain, Store, X } from "lucide-react";
import { listarServicios, obtenerServicio } from "@lauburu/backend/pedidos";
import { CATEGORIAS, UNIDADES_PRECIO } from "@lauburu/backend/servicios";
import { Container } from "@/components/Container";
import { Precio } from "@/components/Moneda";
import { CompraServicio, GaleriaServicio } from "@/components/servicios/CompraServicio";
import {
  Chip,
  EncabezadoSeccion,
  FotoPendiente,
  Seccion,
  Tarjeta,
  claseBoton,
} from "@/components/ui";

// Los cupos cambian con cada pedido.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const servicio = await obtenerServicio((await params).slug);
  return servicio
    ? { title: servicio.nombre, description: servicio.resumen }
    : { title: "Servicio" };
}

export default async function DetalleServicio({ params }: Params) {
  const { slug } = await params;
  const [servicio, todos] = await Promise.all([obtenerServicio(slug), listarServicios()]);
  if (!servicio) notFound();

  const recomendados = todos
    .filter((s) => s.id !== servicio.id && s.incluidoOExtra === "extra")
    .slice(0, 3);
  const ficha = [
    { icono: Store, etiqueta: "Lo ofrece", valor: servicio.aliado },
    { icono: Clock, etiqueta: "Duración", valor: servicio.duracion },
    { icono: Mountain, etiqueta: "Nivel", valor: servicio.nivel },
    { icono: MapPin, etiqueta: "Encuentro", valor: servicio.puntoEncuentro },
  ].filter((f) => f.valor);

  return (
    <>
      <section aria-labelledby="servicio-titulo" className="pt-6 pb-12 md:pt-8 md:pb-24">
        <Container>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <nav aria-label="Miga de pan">
              <ol className="flex flex-wrap items-center gap-2 text-small">
                <li>
                  <Link href="/" className={claseBoton("texto")}>
                    Inicio
                  </Link>
                </li>
                <li aria-hidden>/</li>
                <li>
                  <Link href="/servicios" className={claseBoton("texto")}>
                    Servicios
                  </Link>
                </li>
                <li aria-hidden>/</li>
                <li aria-current="page">{servicio.nombre}</li>
              </ol>
            </nav>
            <Link
              href="/servicios"
              className={`${claseBoton("texto")} inline-flex items-center gap-2 text-small`}
            >
              <ArrowLeft size={16} strokeWidth={1.5} aria-hidden /> Volver a servicios
            </Link>
          </div>

          <div className="mt-8 grid items-start gap-8 lg:grid-cols-12 lg:gap-12">
            <div className="flex flex-col gap-8 lg:col-span-7">
              <GaleriaServicio fotos={servicio.fotos.length ? servicio.fotos : [servicio.nombre]} />

              <div className="flex flex-col gap-4 border-b border-niebla pb-8">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-overline font-medium text-terracota-oscuro uppercase">
                    {CATEGORIAS[servicio.categoria]}
                  </span>
                  <Chip tipo={servicio.incluidoOExtra} />
                </div>
                <h1 id="servicio-titulo" className="font-serif text-h1 text-verde">
                  {servicio.nombre}
                </h1>

                {ficha.length > 0 && (
                  <dl className="grid gap-4 rounded-card border border-niebla bg-blanco p-5 text-small sm:grid-cols-2 md:p-6">
                    {ficha.map(({ icono: Icono, etiqueta, valor }) => (
                      <div key={etiqueta} className="flex items-center gap-2">
                        <Icono
                          size={20}
                          strokeWidth={1.5}
                          className="shrink-0 text-verde"
                          aria-hidden
                        />
                        <dt className="font-medium text-verde">{etiqueta}:</dt>
                        <dd>{valor}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                {/* TODO(cliente): texto definitivo del aliado. */}
                <p className="max-w-[65ch]">{servicio.descripcion}</p>
              </div>

              {(servicio.incluye.length > 0 || servicio.noIncluye.length > 0) && (
                <div className="grid gap-4 md:grid-cols-2 md:gap-6">
                  {servicio.incluye.length > 0 && (
                    <section
                      aria-labelledby="titulo-incluye"
                      className="rounded-card border border-miel bg-blanco p-5 md:p-6"
                    >
                      <h2 id="titulo-incluye" className="font-serif text-h3 text-verde">
                        Qué incluye
                      </h2>
                      <ul className="mt-4 flex flex-col gap-2 text-small">
                        {servicio.incluye.map((x) => (
                          <li key={x} className="flex items-start gap-2">
                            <Check
                              size={20}
                              strokeWidth={1.5}
                              className="shrink-0 text-verde"
                              aria-hidden
                            />{" "}
                            {x}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {servicio.noIncluye.length > 0 && (
                    <section
                      aria-labelledby="titulo-no-incluye"
                      className="rounded-card border border-niebla bg-blanco p-5 md:p-6"
                    >
                      <h2 id="titulo-no-incluye" className="font-serif text-h3 text-verde">
                        Qué no incluye
                      </h2>
                      <ul className="mt-4 flex flex-col gap-2 text-small">
                        {servicio.noIncluye.map((x) => (
                          <li key={x} className="flex items-start gap-2">
                            <X size={20} strokeWidth={1.5} className="shrink-0" aria-hidden /> {x}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                </div>
              )}

              {servicio.condiciones.length > 0 && (
                <section
                  aria-labelledby="titulo-condiciones"
                  className="rounded-card border border-niebla bg-verde-tinte p-5 md:p-6"
                >
                  <h2
                    id="titulo-condiciones"
                    className="flex items-center gap-2 font-serif text-h3 text-verde"
                  >
                    <Info size={24} strokeWidth={1.5} className="shrink-0" aria-hidden /> Antes de
                    reservar
                  </h2>
                  {/* TODO(cliente): confirmar condiciones con cada aliado. */}
                  <dl className="mt-4 flex flex-col gap-4 text-small">
                    {servicio.condiciones.map((c) => (
                      <div key={c.titulo}>
                        <dt className="font-medium text-verde">{c.titulo}</dt>
                        <dd className="mt-1">{c.texto}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}
            </div>

            <aside aria-labelledby="compra-titulo" className="lg:sticky lg:top-24 lg:col-span-5">
              <CompraServicio
                servicio={servicio}
                fechasIniciales={servicio.fechas}
                unidadesIniciales={servicio.unidadesLibres}
              />
            </aside>
          </div>
        </Container>
      </section>

      {recomendados.length > 0 && (
        <Seccion id="recomendados" fondo="verdeTinte">
          <EncabezadoSeccion
            id="recomendados"
            overline="Para tu estadía"
            titulo="Complementa tu experiencia"
            centrado
          />
          <ul className="grid gap-4 md:grid-cols-3 md:gap-6">
            {recomendados.map((s) => (
              <li key={s.id}>
                <Tarjeta borde="miel" className="flex flex-col gap-2">
                  <FotoPendiente descripcion={s.foto} className="aspect-[3/2]" />
                  <div className="mt-2">
                    <Chip tipo={s.incluidoOExtra} />
                  </div>
                  <h3 className="font-serif text-h3 text-verde">{s.nombre}</h3>
                  <p className="text-small">{s.resumen}</p>
                  <div className="mt-auto flex items-center justify-between gap-4 pt-4">
                    <span className="font-bold text-verde">
                      <Precio cop={s.precio} />{" "}
                      <span className="text-small font-normal text-cafe">
                        {UNIDADES_PRECIO[s.unidadPrecio]}
                      </span>
                    </span>
                    <Link
                      href={`/servicios/${s.slug}`}
                      className={`${claseBoton("texto")} text-small`}
                    >
                      Ver detalle
                    </Link>
                  </div>
                </Tarjeta>
              </li>
            ))}
          </ul>
          <div className="mt-8 text-center md:mt-12">
            <Link href="/servicios" className={`${claseBoton("secundario")} w-full sm:w-auto`}>
              Ver todos los servicios
            </Link>
          </div>
        </Seccion>
      )}
    </>
  );
}
