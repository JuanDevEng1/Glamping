// Carga los festivos, las temporadas altas y las fechas especiales de Colombia 2026–2028 sin
// sobrescribir lo que ya exista, y el catálogo real de servicios (cabalgatas) con sus cupos.
// Con --ejemplo también crea la configuración de tarifas DE PRUEBA.
// Uso: npm run db:seed            ·  npm run db:seed:ejemplo
import { eq, like } from "drizzle-orm";
import {
  ajustesFecha,
  aliados,
  configuracion,
  cuposServicio,
  festivos,
  getDb,
  servicios,
  temporadas,
  type Foto,
} from "../src/db";
import { hoyEnBogota } from "../src/moneda";
import {
  calcularFechasEspeciales,
  calcularFestivos,
  calcularTemporadasAltas,
  sumarDias,
} from "../src/precios";

try {
  process.loadEnvFile("../frontend/.env.local");
} catch {
  // En CI/Vercel las variables ya vienen del entorno.
}

const db = getDb();

const ANIOS = [2026, 2027, 2028];

const filas = ANIOS.flatMap(calcularFestivos);
await db.insert(festivos).values(filas).onConflictDoNothing();
console.log(`Festivos: ${filas.length} revisados (los existentes no se modifican).`);

// Las temporadas de ejemplo de versiones anteriores se cruzan con las reales.
await db.delete(temporadas).where(like(temporadas.nombre, "%(ejemplo)"));
const nombresTemporadas = new Set(
  (await db.select({ nombre: temporadas.nombre }).from(temporadas)).map((t) => t.nombre),
);
const nuevasTemporadas = ANIOS.flatMap(calcularTemporadasAltas).filter(
  (t) => !nombresTemporadas.has(t.nombre),
);
if (nuevasTemporadas.length > 0) await db.insert(temporadas).values(nuevasTemporadas);
console.log(`Temporadas altas: ${nuevasTemporadas.length} nuevas.`);

// Una fecha con ajuste propio (precio o bloqueo) no se modifica.
const especiales = ANIOS.flatMap(calcularFechasEspeciales);
await db
  .insert(ajustesFecha)
  .values(especiales.map((e) => ({ fecha: e.fecha, especial: true, motivo: e.nombre })))
  .onConflictDoNothing();
console.log(`Fechas especiales: ${especiales.length} revisadas (las existentes no se modifican).`);

if (process.argv.includes("--ejemplo")) {
  // Tarifas del glamping; temporada alta, fecha especial y adicionales usan los valores por
  // defecto de la tabla (560 000, 650 000, 90 000 y 60 000).
  await db
    .insert(configuracion)
    .values({ precioBase: 420_000, precioAlto: 490_000, precioPersonaExtra: 60_000 })
    .onConflictDoNothing();
  console.log("Configuración lista.");
}

await sembrarCabalgatas();

await db.$client.end();

// ---------------------------------------------------------------------------
// Catálogo real: cabalgatas que opera el glamping. Idempotente (upsert por slug).
// Los cupos se crean DIAS_CUPOS días hacia adelante: vuelve a correr la semilla para extenderlos.
// ---------------------------------------------------------------------------

async function sembrarCabalgatas() {
  const DIAS_CUPOS = 90;
  const CABALLOS = 6;

  const correo = (process.env.CORREO_ADMIN ?? "").split(",")[0]?.trim();
  if (!correo) {
    throw new Error("Falta CORREO_ADMIN: es el correo del aliado 'Lauburu Glamping'.");
  }

  const nombreAliado = "Lauburu Glamping";
  const [existente] = await db
    .select({ id: aliados.id })
    .from(aliados)
    .where(eq(aliados.nombre, nombreAliado))
    .limit(1);
  const aliadoId =
    existente?.id ??
    (
      await db
        .insert(aliados)
        .values({ nombre: nombreAliado, correo })
        .returning({ id: aliados.id })
    )[0]!.id;

  const comunes = {
    aliadoId,
    categoria: "tours",
    unidadPrecio: "caballo",
    tipoStock: "cupos",
    stock: null,
    maxPorPedido: CABALLOS,
    incluidoOExtra: "extra",
    activo: true,
    // TODO(cliente): nivel, punto de encuentro y edad mínima.
    nivel: null,
    puntoEncuentro: null,
    turnos: [],
    incluye: ["Caballo ensillado y listo para montar", "Una persona que te guía y acompaña"],
    noIncluye: [],
    condiciones: [],
  } satisfies Partial<typeof servicios.$inferInsert>;

  // TODO(cliente): fotos propias. Estas son provisionales (en frontend/public/servicios).
  const fotoBosque: Foto = {
    src: "/servicios/cabalgata-pexels.jpg", // Licencia de Pexels: no exige crédito.
    alt: "Dos jinetes a caballo por un camino de bosque, en blanco y negro",
  };
  const fotoEucaliptos: Foto = {
    src: "/servicios/cabalgata-pexels-2.jpg", // Licencia de Pexels: no exige crédito.
    alt: "Jinetes en fila por un sendero entre eucaliptos, con montañas al fondo",
  };
  const fotoSendero: Foto = {
    src: "/servicios/cabalgata-juanedc.jpg",
    alt: "Jinetes en fila por un sendero de pasto verde entre montañas, vistos desde un caballo",
    credito: {
      autor: "Juanedc",
      url: "https://www.flickr.com/photos/juanedc/8990996856/",
      licencia: "CC BY 2.0",
      licenciaUrl: "https://creativecommons.org/licenses/by/2.0/",
    },
  };

  const cabalgatas: (typeof servicios.$inferInsert)[] = [
    {
      ...comunes,
      slug: "cabalgata-30-minutos",
      nombre: "Cabalgata de 30 minutos",
      resumen: "Un paseo corto a caballo por los caminos de la vereda, con guía.",
      descripcion:
        "Recorre a caballo los caminos de la vereda Cuchilla del Salado. Te entregamos el caballo ensillado y listo para montar, y una persona te acompaña y guía todo el camino. La hora la coordinamos contigo por WhatsApp.",
      precio: 60_000,
      orden: 1,
      duracion: "30 minutos",
      fotos: [fotoBosque, fotoSendero],
    },
    {
      ...comunes,
      slug: "cabalgata-hora-y-media",
      nombre: "Cabalgata de 1 hora y media",
      resumen: "Un recorrido largo a caballo entre las montañas de la vereda, con guía.",
      descripcion:
        "Tómate tu tiempo para recorrer a caballo los caminos y paisajes de la vereda Cuchilla del Salado. Te entregamos el caballo ensillado y listo para montar, y una persona te acompaña y guía todo el camino. La hora la coordinamos contigo por WhatsApp.",
      precio: 150_000,
      orden: 2,
      duracion: "1 hora y media",
      fotos: [fotoEucaliptos, fotoBosque],
    },
  ];

  const ids: number[] = [];
  for (const { slug, ...datos } of cabalgatas) {
    const [fila] = await db
      .insert(servicios)
      .values({ slug, ...datos })
      .onConflictDoUpdate({ target: servicios.slug, set: datos })
      .returning({ id: servicios.id });
    ids.push(fila!.id);
  }

  // Los cupos existentes no se tocan, para no perder lo ya reservado.
  const hoy = hoyEnBogota();
  await db
    .insert(cuposServicio)
    .values(
      ids.flatMap((servicioId) =>
        Array.from({ length: DIAS_CUPOS }, (_, i) => ({
          servicioId,
          fecha: sumarDias(hoy, i),
          turno: "",
          capacidad: CABALLOS,
        })),
      ),
    )
    .onConflictDoNothing();

  console.log(`Cabalgatas listas, con cupos para ${DIAS_CUPOS} días.`);
}
