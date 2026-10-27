// Carga los festivos de Colombia 2026–2028 (sin sobrescribir los editados en el panel).
// Con --ejemplo también crea configuración, temporadas y servicios DE PRUEBA para desarrollo local.
// Uso: npm run db:seed            ·  npm run db:seed:ejemplo
import {
  aliados,
  configuracion,
  cuposServicio,
  festivos,
  getDb,
  servicios,
  temporadas,
} from "../src/db";
import { hoyEnBogota } from "../src/moneda";
import { calcularFestivos, sumarDias } from "../src/precios";

try {
  process.loadEnvFile("../frontend/.env.local");
} catch {
  // En CI/Vercel las variables ya vienen del entorno.
}

const db = getDb();

const filas = [2026, 2027, 2028].flatMap(calcularFestivos);
await db.insert(festivos).values(filas).onConflictDoNothing();
console.log(`Festivos: ${filas.length} revisados (los existentes no se modifican).`);

if (process.argv.includes("--ejemplo")) {
  // Tarifas del glamping; temporada alta, fecha especial y adicionales usan los valores por
  // defecto de la tabla (560 000, 650 000, 90 000 y 60 000). Las temporadas son de ejemplo.
  await db
    .insert(configuracion)
    .values({ precioBase: 420_000, precioAlto: 490_000, precioPersonaExtra: 60_000 })
    .onConflictDoNothing();
  const existentes = await db.select({ id: temporadas.id }).from(temporadas).limit(1);
  if (existentes.length === 0) {
    await db.insert(temporadas).values([
      {
        nombre: "Fin de año (ejemplo)",
        fechaInicio: "2026-12-15",
        fechaFin: "2027-01-15",
        precioNoche: null,
        precioPersonaExtra: 80_000,
        minimoNoches: 2,
      },
      {
        nombre: "Semana Santa (ejemplo)",
        fechaInicio: "2027-03-20",
        fechaFin: "2027-03-28",
        precioNoche: null,
        precioPersonaExtra: null,
        minimoNoches: 2,
      },
    ]);
  }
  console.log("Configuración y temporadas de ejemplo listas.");

  if ((await db.select({ id: servicios.id }).from(servicios).limit(1)).length === 0) {
    await sembrarServicios();
    console.log("Aliados, servicios y cupos de ejemplo listos (60 días).");
  }
}

await db.$client.end();

// ---------------------------------------------------------------------------
// Servicios DE EJEMPLO (tomados de las maquetas). TODO(cliente): aliados, textos y precios reales.
// ---------------------------------------------------------------------------

async function sembrarServicios() {
  const [finca, cocina, transporte] = await db
    .insert(aliados)
    .values([
      { nombre: "Finca aliada de la vereda (ejemplo)", correo: "finca@example.com" },
      { nombre: "Cocina del glamping (ejemplo)", correo: "cocina@example.com" },
      { nombre: "Transporte rural (ejemplo)", correo: "transporte@example.com" },
    ])
    .returning({ id: aliados.id });

  const creados = await db
    .insert(servicios)
    .values([
      {
        slug: "cabalgata-al-mirador",
        aliadoId: finca!.id,
        nombre: "Cabalgata al mirador",
        categoria: "tours",
        resumen: "A caballo entre cafetales y bosque de niebla hasta un mirador de la vereda.",
        descripcion:
          "Recorre a caballo los caminos de herradura de la vereda Cuchilla del Salado, entre cafetales y bosque de niebla, hasta un mirador con vista a las montañas de Manizales. Te acompaña un guía local todo el camino.",
        precio: 85_000,
        unidadPrecio: "persona",
        tipoStock: "cupos",
        maxPorPedido: 4,
        orden: 1,
        duracion: "2 horas y media",
        nivel: "Moderado, apto para principiantes",
        puntoEncuentro: "Entrada del glamping",
        turnos: ["09:00", "15:00"],
        incluye: [
          "Caballo manso con montura",
          "Casco de protección",
          "Guía local durante el recorrido",
        ],
        noIncluye: ["Propinas para el guía", "Calzado cerrado y ropa para lluvia"],
        condiciones: [
          { titulo: "Edad mínima", texto: "Desde los 8 años, en compañía de un adulto." },
        ],
        fotos: [
          "Caballos en un sendero de montaña con bosque de niebla",
          "Vista panorámica desde el mirador",
          "Guía local junto a los caballos",
        ],
      },
      {
        slug: "cena-junto-a-la-fogata",
        aliadoId: cocina!.id,
        nombre: "Cena junto a la fogata",
        categoria: "gastronomia",
        resumen: "Cena de tres tiempos preparada al fuego, junto a la fogata.",
        descripcion:
          "Una cena de tres tiempos preparada al fuego, servida junto a la fogata al anochecer.",
        precio: 180_000,
        unidadPrecio: "pareja",
        tipoStock: "cupos",
        maxPorPedido: 3,
        orden: 2,
        duracion: "2 horas",
        turnos: ["19:00"],
        incluye: ["Entrada, plato fuerte y postre", "Bebida caliente"],
        fotos: ["Cena servida junto a una fogata al anochecer"],
      },
      {
        slug: "picnic-en-el-mirador",
        aliadoId: cocina!.id,
        nombre: "Picnic en el mirador",
        categoria: "gastronomia",
        resumen: "Canasta con quesos, pan y frutas de la región para disfrutar en la montaña.",
        descripcion:
          "Una canasta con quesos, pan artesanal y frutas de la región, lista para llevar al mirador.",
        precio: 70_000,
        unidadPrecio: "pareja",
        tipoStock: "unidades",
        stock: 10,
        maxPorPedido: 2,
        orden: 3,
        incluye: ["Canasta y manta", "Quesos, pan y frutas"],
        fotos: ["Canasta de picnic sobre una manta en la montaña"],
      },
      {
        slug: "transporte-desde-manizales",
        aliadoId: transporte!.id,
        nombre: "Transporte desde Manizales",
        categoria: "transporte",
        resumen: "Te recogemos en Manizales y te llevamos en 4x4 hasta el glamping.",
        descripcion:
          "Te recogemos en Manizales y te llevamos en un vehículo 4x4 hasta el glamping. Hasta 4 pasajeros.",
        precio: 90_000,
        unidadPrecio: "trayecto",
        tipoStock: "cupos",
        maxPorPedido: 1,
        orden: 4,
        duracion: "45 minutos",
        turnos: ["10:00", "14:00"],
        fotos: ["Camioneta 4x4 en un camino rural de montaña"],
      },
      {
        slug: "tour-de-cafe",
        aliadoId: finca!.id,
        nombre: "Tour de café en finca",
        categoria: "fincas",
        resumen: "Conoce el café desde la semilla hasta la taza en una finca vecina.",
        descripcion:
          "Recorre una finca cafetera de la zona y conoce el proceso del café desde la semilla hasta la taza.",
        precio: 110_000,
        unidadPrecio: "persona",
        tipoStock: "cupos",
        maxPorPedido: 6,
        orden: 5,
        duracion: "3 horas",
        turnos: ["09:00"],
        fotos: ["Recolección de café en una finca vecina"],
      },
      {
        slug: "kit-de-celebracion",
        aliadoId: cocina!.id,
        nombre: "Kit de celebración",
        categoria: "decoracion",
        resumen: "Decoración sencilla para cumpleaños, aniversarios o propuestas.",
        descripcion:
          "Preparamos el glamping con una decoración sencilla para tu celebración antes de tu llegada.",
        precio: 120_000,
        unidadPrecio: "unidad",
        tipoStock: "unidades",
        stock: 5,
        maxPorPedido: 1,
        orden: 6,
        fotos: ["Decoración con flores y velas en el glamping"],
      },
      {
        slug: "cafe-de-bienvenida",
        aliadoId: cocina!.id,
        nombre: "Café de bienvenida",
        categoria: "gastronomia",
        resumen: "Un café de la zona para recibirte al llegar.",
        descripcion: "Al llegar te recibimos con un café de la zona.",
        precio: 0,
        unidadPrecio: "persona",
        tipoStock: "unidades",
        stock: 0,
        incluidoOExtra: "incluido",
        orden: 7,
        fotos: ["Taza de café sobre una mesa de madera"],
      },
    ])
    .returning({
      id: servicios.id,
      tipoStock: servicios.tipoStock,
      turnos: servicios.turnos,
      slug: servicios.slug,
    });

  const hoy = hoyEnBogota();
  const cupos = creados
    .filter((s) => s.tipoStock === "cupos")
    .flatMap((s) =>
      Array.from({ length: 60 }, (_, i) => sumarDias(hoy, i)).flatMap((fecha) =>
        (s.turnos.length ? s.turnos : [""]).map((turno) => ({
          servicioId: s.id,
          fecha,
          turno,
          capacidad: s.slug === "transporte-desde-manizales" ? 1 : 6,
        })),
      ),
    );
  await db.insert(cuposServicio).values(cupos);
}
