import type { Metadata } from "next";
import Link from "next/link";
import { Check, MapPin, Route, TriangleAlert, Users } from "lucide-react";
import { obtenerConfiguracion } from "@lauburu/backend/db";
import { trmParaCobro } from "@lauburu/backend/moneda";
import { Container } from "@/components/Container";
import { NotaMoneda, Precio } from "@/components/Moneda";
import {
  Chip,
  EncabezadoSeccion,
  Faq,
  FotoPendiente,
  Seccion,
  Tarjeta,
  claseBoton,
} from "@/components/ui";
import { formatoHora } from "@/lib/formato";
import { enlaceMapa, enlaceWaze, enlaceWhatsApp, sitio } from "@/lib/sitio";

export const metadata: Metadata = {
  description:
    "Lauburu es un glamping privado en la Vereda Cuchilla del Salado, Manizales. Hasta 6 personas, jacuzzi, malla catamarán y vista a las montañas.",
};

// ---------------------------------------------------------------------------
// Contenido de borrador. TODO(cliente): validar todos los textos marcados.
// ---------------------------------------------------------------------------

// TODO(cliente): confirmar la lista completa de lo que incluye la estadía.
const incluidos = [
  "Jacuzzi privado",
  "Malla catamarán para descansar al aire libre (hasta 180 kg)",
  "Ventanal con vista a las montañas",
];

// TODO(cliente): confirmar experiencias, textos y si cada una es Incluido o Extra.
// Por defecto "extra" para no prometer algo sin costo.
const experiencias = [
  {
    titulo: "Cultura cafetera",
    texto: "Recorre una finca de la zona y conoce el café desde la semilla hasta la taza.",
    foto: "Recolección de café en una finca vecina",
    tipo: "extra",
  },
  {
    titulo: "Cabalgata",
    texto: "Un paseo a caballo por los caminos de la vereda, a tu ritmo.",
    foto: "Cabalgata por un camino rural entre montañas",
    tipo: "extra",
  },
  {
    titulo: "Recorridos guiados",
    texto: "Caminatas con guías locales por el bosque y los miradores cercanos.",
    foto: "Sendero de bosque con niebla de la mañana",
    tipo: "extra",
  },
] as const;

const galeria = [
  { foto: "El glamping al atardecer con las montañas de fondo", ancha: true },
  { foto: "Jacuzzi exterior con vista al valle" },
  { foto: "Malla catamarán sobre el paisaje" },
  { foto: "Interior junto al ventanal" },
  { foto: "Niebla de la mañana en la vereda" },
];

const respuestaPorWhatsApp = (
  <p>
    Escríbenos por{" "}
    <a
      href={enlaceWhatsApp()}
      target="_blank"
      rel="noopener noreferrer"
      className={claseBoton("texto")}
    >
      WhatsApp
    </a>{" "}
    y te contamos los detalles.
  </p>
);

// ---------------------------------------------------------------------------

export default async function Nosotros() {
  const [config, trm] = await Promise.all([obtenerConfiguracion(), trmParaCobro()]);
  const trmValor = trm?.valor ?? null;
  const incluidas = config?.huespedesIncluidos ?? 2;
  const maximo = config?.maxHuespedes ?? 6;

  const preguntas = [
    {
      pregunta: "¿A qué hora es el check-in y el check-out?",
      respuesta: config ? (
        <p>
          Puedes llegar desde las {formatoHora(config.horaCheckin)} y la salida es hasta las{" "}
          {formatoHora(config.horaCheckout)}.
        </p>
      ) : (
        <p>Te confirmamos los horarios de llegada y salida al hacer tu reserva.</p>
      ),
    },
    {
      pregunta: "¿Hay parqueadero?",
      respuesta: <p>Sí, hay espacio para 3 carros o 6 motos.</p>,
    },
    {
      pregunta: "¿Puedo llevar a mi mascota?",
      respuesta: config ? (
        <p>
          Sí, tu mascota es bienvenida. Tiene un valor adicional de{" "}
          <Precio cop={config.precioMascota} trm={trmValor} /> por noche por cada mascota; lo
          agregas al elegir los huéspedes.
        </p>
      ) : (
        <p>Sí, tu mascota es bienvenida, con un valor adicional por noche.</p>
      ),
    },
    {
      pregunta: "¿Cuánto peso resiste la malla catamarán?",
      respuesta: (
        <p>Hasta 180 kg en total al mismo tiempo. Así la disfrutan todos con seguridad.</p>
      ),
    },
    {
      pregunta: "¿Qué clima hace y qué ropa debo llevar?",
      // TODO(cliente): confirmar.
      respuesta: (
        <p>
          Es clima de montaña: días templados y noches frías. Trae abrigo, ropa cómoda para caminar
          y vestido de baño para el jacuzzi.
        </p>
      ),
    },
    // TODO(cliente): responder alimentos.
    { pregunta: "¿Puedo llevar mi propia comida y bebidas?", respuesta: respuestaPorWhatsApp },
  ];

  return (
    <>
      {/* 1. Portada */}
      {/* TODO(cliente): foto a sangre con next/image (priority, fill, object-cover) y overlay bg-verde/40. */}
      <section
        aria-labelledby="portada-titulo"
        className="on-dark flex min-h-[80svh] items-center bg-verde py-12 text-crema md:min-h-[90vh]"
      >
        <Container>
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-overline font-medium text-miel">{sitio.descriptiva}</p>
            <h1 id="portada-titulo" className="mt-4 font-serif text-h1">
              Tu refugio entre las montañas de Manizales
            </h1>
            <p className="mx-auto mt-6 max-w-[65ch] opacity-85">
              Un glamping privado para desconectarte, con espacio para hasta {maximo} personas.
            </p>
            <div className="mt-8 flex flex-col items-center gap-6 sm:flex-row sm:justify-center">
              <Link href="/reservas" className={`${claseBoton("primario")} w-full sm:w-auto`}>
                Ver disponibilidad
              </Link>
              <a href="#como-llegar" className={claseBoton("textoSobreVerde")}>
                Cómo llegar
              </a>
            </div>
          </div>
        </Container>
      </section>

      {/* 2. Quiénes somos */}
      {/* TODO(cliente): reemplazar por la historia real del glamping. */}
      <Seccion id="nosotros">
        <div className="grid items-center gap-8 md:grid-cols-2 md:gap-12">
          <FotoPendiente
            descripcion="Los anfitriones frente al glamping"
            className="aspect-[4/5] md:order-last md:aspect-[3/2]"
          />
          <div>
            <p className="text-overline font-medium text-terracota-oscuro">QUIÉNES SOMOS</p>
            <h2 id="nosotros-titulo" className="mt-2 font-serif text-h2 text-verde">
              Un lugar hecho para descansar
            </h2>
            <div className="mt-6 max-w-[65ch] space-y-4">
              <p>
                Lauburu nació del deseo de compartir la calma de la montaña caldense. En la Vereda
                Cuchilla del Salado, a las afueras de Manizales, creamos un espacio íntimo para que
                despiertes con la niebla sobre las montañas y termines el día en silencio, rodeado
                de naturaleza.
              </p>
              <p>Aquí no hay prisa: solo tú, tu gente y el paisaje cafetero.</p>
            </div>
            <a href="#alojamiento" className={`${claseBoton("texto")} mt-6 inline-block`}>
              Conoce el alojamiento
            </a>
          </div>
        </div>
      </Seccion>

      {/* 3. El alojamiento */}
      <Seccion id="alojamiento" fondo="verdeTinte">
        <EncabezadoSeccion
          id="alojamiento"
          overline="El alojamiento"
          titulo="Todo el glamping para ti"
          subtitulo="Es un solo alojamiento privado: no compartes espacios con otros huéspedes."
        />
        <Tarjeta className="grid gap-6 lg:grid-cols-12">
          <div className="space-y-2 lg:col-span-7">
            <FotoPendiente
              descripcion="Vista general del glamping con las montañas al fondo"
              className="aspect-[3/2]"
            />
            <div className="grid grid-cols-4 gap-2">
              {["Jacuzzi", "Malla", "Ventanal", "Interior"].map((foto) => (
                <FotoPendiente key={foto} descripcion={foto} className="aspect-square" />
              ))}
            </div>
          </div>

          <div className="flex flex-col justify-between gap-6 lg:col-span-5 lg:border-l lg:border-niebla lg:pl-6">
            <div>
              <h3 className="font-serif text-h3 text-verde">Tu refugio privado</h3>
              <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-niebla px-3 py-1 text-small text-verde">
                <Users size={16} strokeWidth={1.5} aria-hidden />
                Hasta {maximo} personas
              </p>
              <p className="mt-6 text-overline font-medium text-terracota-oscuro">INCLUIDO</p>
              <ul className="mt-3 space-y-2">
                {incluidos.map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <Check
                      size={20}
                      strokeWidth={1.5}
                      className="shrink-0 text-verde"
                      aria-hidden
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col gap-4 border-t border-niebla pt-6 sm:flex-row sm:items-center sm:justify-between lg:flex-col lg:items-start">
              {config ? (
                <p>
                  <span className="block text-small">Desde</span>
                  <span className="text-h3 font-bold text-verde">
                    <Precio cop={config.precioBase} trm={trmValor} />
                  </span>
                  <span className="block text-small">por noche para {incluidas} personas</span>
                </p>
              ) : (
                <p className="text-small">Consulta la tarifa de cada noche en el calendario.</p>
              )}
              <Link href="/reservas" className={`${claseBoton("primario")} w-full sm:w-auto`}>
                Reservar
              </Link>
            </div>
          </div>
        </Tarjeta>
      </Seccion>

      {/* 4. Tarifas y temporadas */}
      {/* TODO(fase 2): franja de próximos festivos desde la tabla festivos. */}
      <Seccion id="tarifas">
        <EncabezadoSeccion
          id="tarifas"
          overline="Tarifas"
          titulo="Tarifas y temporadas"
          subtitulo="El precio de cada noche depende del día y la temporada. En el calendario de reservas ves el valor exacto antes de pagar."
        />

        <div className="flex items-start gap-4 rounded-card border border-miel bg-blanco p-5 md:p-6">
          <Users size={24} strokeWidth={1.5} className="mt-1 shrink-0 text-verde" aria-hidden />
          <p className="max-w-[65ch]">
            La tarifa incluye {incluidas} personas. El glamping recibe hasta {maximo}, de cualquier
            edad; desde la persona {incluidas + 1} se suma{" "}
            {config ? (
              <strong className="font-medium text-verde">
                <Precio cop={config.precioPersonaExtra} trm={trmValor} />
              </strong>
            ) : (
              "un valor adicional"
            )}{" "}
            por persona y por noche.
            {config && config.maxAdicionales > 0 && (
              <>
                {" "}
                Si son más de {maximo}, puedes sumar hasta {config.maxAdicionales} acompañantes:
                adultos a{" "}
                <strong className="font-medium text-verde">
                  <Precio cop={config.precioAdicionalAdulto} trm={trmValor} />
                </strong>{" "}
                por noche con desayuno, niños de 4 a 11 años a{" "}
                <strong className="font-medium text-verde">
                  <Precio cop={config.precioAdicionalNino} trm={trmValor} />
                </strong>{" "}
                por noche y menores de 4 años gratis.
              </>
            )}
          </p>
        </div>

        <div className="mt-4 grid gap-4 md:mt-6 md:grid-cols-2 md:gap-6 lg:grid-cols-4">
          <Tarjeta className="flex flex-col justify-between gap-6">
            <div>
              <p className="text-overline font-medium text-terracota-oscuro">DOMINGO A JUEVES</p>
              <h3 className="mt-2 font-serif text-h3 text-verde">Entre semana</h3>
              <p className="mt-2 text-small">
                Noches de domingo a jueves, la opción más tranquila.
              </p>
            </div>
            {config && (
              <p className="border-t border-niebla pt-4 font-bold text-verde">
                <Precio cop={config.precioBase} trm={trmValor} />
                <span className="font-normal text-cafe"> / noche</span>
              </p>
            )}
          </Tarjeta>
          <Tarjeta className="flex flex-col justify-between gap-6">
            <div>
              <p className="text-overline font-medium text-terracota-oscuro">
                VIERNES, SÁBADO Y PUENTES
              </p>
              <h3 className="mt-2 font-serif text-h3 text-verde">Fin de semana</h3>
              <p className="mt-2 text-small">
                Noches de viernes y sábado, y la noche anterior a un festivo.
              </p>
            </div>
            {config && (
              <p className="border-t border-niebla pt-4 font-bold text-verde">
                <Precio cop={config.precioAlto} trm={trmValor} />
                <span className="font-normal text-cafe"> / noche</span>
              </p>
            )}
          </Tarjeta>
          <Tarjeta className="flex flex-col justify-between gap-6">
            <div>
              <p className="text-overline font-medium text-terracota-oscuro">VACACIONES</p>
              <h3 className="mt-2 font-serif text-h3 text-verde">Temporada alta</h3>
              <p className="mt-2 text-small">
                Diciembre y enero, Semana Santa y vacaciones de mitad de año.
              </p>
            </div>
            {config && (
              <p className="border-t border-niebla pt-4 font-bold text-verde">
                <Precio cop={config.precioTemporada} trm={trmValor} />
                <span className="font-normal text-cafe"> / noche</span>
              </p>
            )}
          </Tarjeta>
          <Tarjeta className="flex flex-col justify-between gap-6">
            <div>
              <p className="text-overline font-medium text-terracota-oscuro">NOCHES PUNTUALES</p>
              <h3 className="mt-2 font-serif text-h3 text-verde">Fecha especial</h3>
              <p className="mt-2 text-small">
                Nochebuena, 31 de diciembre, Día de la Madre, Día del Padre, Amor y Amistad y otras
                noches de celebración. Las verás marcadas en el calendario.
              </p>
            </div>
            {config && (
              <p className="border-t border-niebla pt-4 font-bold text-verde">
                <Precio cop={config.precioFechaEspecial} trm={trmValor} />
                <span className="font-normal text-cafe"> / noche</span>
              </p>
            )}
          </Tarjeta>
        </div>

        <NotaMoneda trm={trm} className="mt-4 max-w-[65ch]" />

        <Link href="/reservas" className={`${claseBoton("secundario")} mt-8 w-full sm:w-auto`}>
          Ver calendario
        </Link>
      </Seccion>

      {/* 5. Experiencias */}
      <Seccion id="experiencias" fondo="verdeTinte">
        <EncabezadoSeccion
          id="experiencias"
          overline="Experiencias"
          titulo="Vive el paisaje cafetero"
          subtitulo="Planes para complementar tu estadía, con fincas y guías de la zona."
        />
        <div className="grid gap-4 md:grid-cols-3 md:gap-6">
          {experiencias.map(({ titulo, texto, foto, tipo }) => (
            <Tarjeta key={titulo} borde="miel">
              <FotoPendiente descripcion={foto} className="aspect-[3/2]" />
              <div className="mt-4 flex items-start justify-between gap-4">
                <h3 className="font-serif text-h3 text-verde">{titulo}</h3>
                <Chip tipo={tipo} />
              </div>
              <p className="mt-2 text-small">{texto}</p>
            </Tarjeta>
          ))}
        </div>
        <Link href="/servicios" className={`${claseBoton("texto")} mt-8 inline-block`}>
          Ver todos los servicios
        </Link>
      </Seccion>

      {/* 6. Galería */}
      {/* TODO(fase 1): lightbox cuando lleguen las fotos reales. */}
      <Seccion id="galeria">
        <EncabezadoSeccion id="galeria" overline="Galería" titulo="Así se ve Lauburu" />
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 md:gap-4">
          {galeria.map(({ foto, ancha }) => (
            <FotoPendiente
              key={foto}
              descripcion={foto}
              className={ancha ? "col-span-2 aspect-video" : "aspect-[4/5]"}
            />
          ))}
        </div>
      </Seccion>

      {/* 7. Cómo llegar */}
      {/* TODO(cliente): coordenadas exactas para el mapa, indicaciones y estado de la vía. */}
      <Seccion id="como-llegar" fondo="verdeTinte">
        <EncabezadoSeccion id="como-llegar" overline="Ubicación" titulo="Cómo llegar" />
        <div className="grid gap-4 md:gap-6 lg:grid-cols-12">
          <FotoPendiente
            bloque
            descripcion="Mapa de ubicación del glamping"
            className="aspect-[4/3] lg:col-span-7 lg:aspect-auto lg:min-h-96"
          />
          <Tarjeta className="lg:col-span-5">
            <dl className="divide-y divide-niebla">
              <div className="pb-4">
                <dt className="flex items-center gap-2 font-medium text-verde">
                  <MapPin size={20} strokeWidth={1.5} aria-hidden /> Dirección
                </dt>
                <dd className="mt-1">{sitio.direccion}</dd>
              </div>
              <div className="py-4">
                <dt className="flex items-center gap-2 font-medium text-verde">
                  <Route size={20} strokeWidth={1.5} aria-hidden /> Indicaciones
                </dt>
                <dd className="mt-1">
                  Escríbenos y te compartimos la ruta paso a paso desde Manizales.
                </dd>
              </div>
              <div className="pt-4">
                <dt className="flex items-center gap-2 font-medium text-verde">
                  <TriangleAlert size={20} strokeWidth={1.5} aria-hidden /> Estado de la vía
                </dt>
                <dd className="mt-1">Antes de tu llegada te contamos cómo está la vía.</dd>
              </div>
            </dl>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row">
              <a
                href={enlaceMapa()}
                target="_blank"
                rel="noopener noreferrer"
                className={claseBoton("secundario")}
              >
                Abrir en Google Maps
              </a>
              <a
                href={enlaceWaze()}
                target="_blank"
                rel="noopener noreferrer"
                className={claseBoton("secundario")}
              >
                Abrir en Waze
              </a>
            </div>
          </Tarjeta>
        </div>
      </Seccion>

      {/* 8. Preguntas frecuentes */}
      <Seccion id="preguntas-frecuentes">
        <EncabezadoSeccion
          id="preguntas-frecuentes"
          overline="Preguntas frecuentes"
          titulo="Resolvemos tus dudas"
          centrado
        />
        <div className="mx-auto max-w-3xl">
          <Faq preguntas={preguntas} />
        </div>
      </Seccion>

      {/* 9. Cierre */}
      <Seccion id="reserva-final" fondo="verdeTinte">
        <div className="mx-auto max-w-3xl text-center">
          <h2 id="reserva-final-titulo" className="font-serif text-h2 text-verde">
            ¿Listo para desconectarte?
          </h2>
          <p className="mx-auto mt-4 max-w-[65ch]">
            Elige tus fechas, mira el precio de cada noche y asegura tu refugio.
          </p>
          <div className="mt-8 flex flex-col items-center gap-6 sm:flex-row sm:justify-center">
            <Link href="/reservas" className={`${claseBoton("primario")} w-full sm:w-auto`}>
              Reservar ahora
            </Link>
            <a
              href={enlaceWhatsApp()}
              target="_blank"
              rel="noopener noreferrer"
              className={claseBoton("texto")}
            >
              o escríbenos por WhatsApp
            </a>
          </div>
        </div>
      </Seccion>
    </>
  );
}
