// Componentes base de UI (REGLAS_WEB.md §5). Sin estado: sirven en componentes de servidor.
import { MessageCircle, Minus, Plus } from "lucide-react";
import { Container } from "./Container";
import { enlaceWhatsApp } from "@/lib/sitio";

// ---------------------------------------------------------------------------
// Botones (§5.1). Devuelve clases para usar en <Link>, <a> o <button>.
// ---------------------------------------------------------------------------

type VarianteBoton = "primario" | "secundario" | "sobreVerde" | "texto" | "textoSobreVerde";

const botonBase =
  "inline-flex items-center justify-center gap-2 rounded-full text-button font-medium transition-colors duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";

const variantesBoton: Record<VarianteBoton, string> = {
  primario: `${botonBase} bg-terracota text-crema hover:bg-terracota-oscuro`,
  secundario: `${botonBase} border-[1.5px] border-verde text-verde hover:bg-verde hover:text-crema`,
  sobreVerde: `${botonBase} bg-crema text-verde hover:bg-blanco`,
  texto:
    "text-terracota underline underline-offset-4 transition-colors duration-200 hover:text-terracota-oscuro",
  textoSobreVerde: "text-crema underline underline-offset-4",
};

const tamanosBoton = {
  normal: "h-12 px-8",
  compacto: "h-11 px-6 lg:h-12 lg:px-8",
};

export function claseBoton(
  variante: VarianteBoton = "primario",
  tamano: keyof typeof tamanosBoton = "normal",
) {
  return variante.startsWith("texto")
    ? variantesBoton[variante]
    : `${variantesBoton[variante]} ${tamanosBoton[tamano]}`;
}

// ---------------------------------------------------------------------------
// Secciones (§1.2, §3.1)
// ---------------------------------------------------------------------------

const fondosSeccion = {
  crema: "bg-crema",
  verdeTinte: "bg-verde-tinte",
  verde: "on-dark bg-verde text-crema",
};

/** El título de la sección debe llevar id `${id}-titulo` (lo pone EncabezadoSeccion). */
export function Seccion({
  id,
  fondo = "crema",
  children,
}: {
  id: string;
  fondo?: keyof typeof fondosSeccion;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-titulo`}
      className={`scroll-mt-16 py-12 md:scroll-mt-18 md:py-24 ${fondosSeccion[fondo]}`}
    >
      <Container>{children}</Container>
    </section>
  );
}

export function EncabezadoSeccion({
  id,
  overline,
  titulo,
  subtitulo,
  centrado = false,
}: {
  id: string;
  overline: string;
  titulo: string;
  subtitulo?: string;
  centrado?: boolean;
}) {
  return (
    <div className={`mb-6 max-w-3xl md:mb-12 ${centrado ? "mx-auto text-center" : ""}`}>
      <p className="text-overline font-medium text-terracota-oscuro uppercase">{overline}</p>
      <h2 id={`${id}-titulo`} className="mt-2 font-serif text-h2 text-verde">
        {titulo}
      </h2>
      {subtitulo && <p className={`mt-4 max-w-[65ch] ${centrado ? "mx-auto" : ""}`}>{subtitulo}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tarjetas y chips (§4, §5.4)
// ---------------------------------------------------------------------------

export function Tarjeta({
  borde = "niebla",
  className = "",
  children,
}: {
  borde?: "miel" | "niebla";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <article
      className={`h-full rounded-card border bg-blanco p-5 md:p-6 ${borde === "miel" ? "border-miel" : "border-niebla"} ${className}`}
    >
      {children}
    </article>
  );
}

export function Chip({ tipo }: { tipo: "incluido" | "extra" }) {
  return tipo === "incluido" ? (
    <span className="inline-flex rounded-full bg-verde px-3 py-1 text-xs font-medium text-crema">
      Incluido
    </span>
  ) : (
    <span className="inline-flex rounded-full border border-terracota-oscuro px-3 py-1 text-xs font-medium text-terracota-oscuro">
      Extra
    </span>
  );
}

// ---------------------------------------------------------------------------
// Foto pendiente: ocupa el lugar de una foto real mientras llega el material.
// TODO(cliente): reemplazar cada uso por next/image con alt descriptivo y sizes.
// ---------------------------------------------------------------------------

export function FotoPendiente({
  descripcion,
  bloque = false,
  className = "",
}: {
  descripcion: string;
  bloque?: boolean;
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label={descripcion}
      className={`flex items-end overflow-hidden bg-niebla p-3 md:p-4 ${bloque ? "rounded-block" : "rounded-card"} ${className}`}
    >
      <span className="text-xs text-verde md:text-small">{descripcion}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preguntas frecuentes (§5.7). <details> nativo: accesible y sin JS de cliente.
// ---------------------------------------------------------------------------

export function Faq({
  preguntas,
}: {
  preguntas: { pregunta: string; respuesta: React.ReactNode }[];
}) {
  return (
    <div className="divide-y divide-niebla border-y border-niebla">
      {preguntas.map(({ pregunta, respuesta }) => (
        <details key={pregunta} className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 py-4 font-medium text-verde [&::-webkit-details-marker]:hidden">
            {pregunta}
            <Plus
              size={20}
              strokeWidth={1.5}
              className="shrink-0 text-miel group-open:hidden"
              aria-hidden
            />
            <Minus
              size={20}
              strokeWidth={1.5}
              className="hidden shrink-0 text-miel group-open:block"
              aria-hidden
            />
          </summary>
          <div className="max-w-[65ch] pb-4">{respuesta}</div>
        </details>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página temporal para vistas que llegan en fases posteriores.
// ---------------------------------------------------------------------------

export function Proximamente({
  overline,
  titulo,
  texto,
  mensajeWhatsApp,
}: {
  overline: string;
  titulo: string;
  texto: string;
  mensajeWhatsApp: string;
}) {
  return (
    <section aria-labelledby="proximamente-titulo" className="py-12 md:py-24">
      <Container>
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-overline font-medium text-terracota-oscuro uppercase">{overline}</p>
          <h1 id="proximamente-titulo" className="mt-4 font-serif text-h1 text-verde">
            {titulo}
          </h1>
          <p className="mx-auto mt-6 max-w-[65ch]">{texto}</p>
          <a
            href={enlaceWhatsApp(mensajeWhatsApp)}
            target="_blank"
            rel="noopener noreferrer"
            className={`${claseBoton("primario")} mt-8 w-full sm:w-auto`}
          >
            <MessageCircle size={20} strokeWidth={1.5} aria-hidden />
            Escríbenos por WhatsApp
          </a>
        </div>
      </Container>
    </section>
  );
}
