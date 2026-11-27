// Carga los festivos de Colombia 2026–2028 (sin sobrescribir los editados en el panel).
// Con --ejemplo también crea configuración, temporadas y servicio DE PRUEBA para desarrollo local.
// Uso: npm run db:seed            ·  npm run db:seed:ejemplo
import { aliados, configuracion, festivos, getDb, servicios, temporadas } from "../src/db";
import { calcularFestivos } from "../src/precios";

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
    console.log("Aliado y cabalgata de ejemplo listos (6 personas por turno).");
  }
}

await db.$client.end();

// ---------------------------------------------------------------------------
// Servicio DE EJEMPLO (tomados de las maquetas). TODO(cliente): aliados, textos y precios reales.
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

  await db.insert(servicios).values([
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
      capacidadTurno: 6,
      fotos: [
        "Caballos en un sendero de montaña con bosque de niebla",
        "Vista panorámica desde el mirador",
        "Guía local junto a los caballos",
      ],
    },
  ]);
  // Sin cupos por fecha: la cabalgata usa capacidadTurno todos los días. Para cerrar un día o
  // cambiar su capacidad: npm run admin -- cabalgata cerrar|capacidad.
}
