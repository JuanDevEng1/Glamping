// Tareas del administrador desde la terminal (no hay panel). Usa la BD de DATABASE_URL.
// Ayuda: npm run admin -- ayuda
import { parseArgs } from "node:util";
import {
  abrirCabalgata,
  cancelarReservaAdmin,
  crearCodigoDescuento,
  crearReservaAdmin,
  desactivarCodigoDescuento,
  fijarCapacidadCabalgata,
  fijarPrecioCabalgata,
  listarCabalgatas,
  listarCodigos,
  listarReservas,
  listarServiciosCabalgata,
  type ResultadoCupoCabalgata,
} from "../src/admin";
import { getDb } from "../src/db";

try {
  process.loadEnvFile("../frontend/.env.local");
} catch {
  // En CI/Netlify las variables ya vienen del entorno.
}

const AYUDA = `Uso: npm run admin -- <comando> [opciones]

Reservas sin pago (ocupan las noches como una reserva confirmada):
  reservar --tipo rifa|cortesia|mantenimiento --llegada AAAA-MM-DD --salida AAAA-MM-DD --motivo "…"
           [--nombre "…" --correo … --telefono … --huespedes 2 --tipo-documento CC --documento …]
           (rifa y cortesía piden nombre, correo y telefono; mantenimiento no)
  liberar LAU-XXXXXXXX            Cancela una reserva del admin y libera las noches
  reservas [--desde AAAA-MM-DD]   Lista las reservas que ocupan noches

Códigos de descuento (solo reservas del glamping):
  codigo crear PROMO15 --porcentaje 15 [--desde AAAA-MM-DD --hasta AAAA-MM-DD]
           [--estadia-desde AAAA-MM-DD --estadia-hasta AAAA-MM-DD --usos 10 --descripcion "…"]
  codigo desactivar PROMO15
  codigos                         Lista los códigos con sus usos

Cabalgatas (va todo el grupo, un caballo por persona; se agregan al reservar):
  cabalgata [--desde AAAA-MM-DD]  Cabalgatas, caballos y precio, y las próximas reservadas
  cabalgata cerrar --fecha AAAA-MM-DD [--servicio cabalgata-… --turno 09:00]
  cabalgata abrir --fecha AAAA-MM-DD [--servicio cabalgata-…]   Vuelve a la capacidad normal
  cabalgata capacidad --capacidad 6 [--servicio cabalgata-… --fecha AAAA-MM-DD]
           (sin --fecha cambia los caballos de todos los días; sin --servicio, de todas)
  cabalgata precio --servicio cabalgata-30-minutos --valor 60000   Precio por caballo

La llegada es la primera noche y la salida es el día en que se van (no se cuenta como noche).`;

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    tipo: { type: "string" },
    llegada: { type: "string" },
    salida: { type: "string" },
    motivo: { type: "string" },
    nombre: { type: "string" },
    correo: { type: "string" },
    telefono: { type: "string" },
    huespedes: { type: "string" },
    "tipo-documento": { type: "string" },
    documento: { type: "string" },
    porcentaje: { type: "string" },
    desde: { type: "string" },
    hasta: { type: "string" },
    "estadia-desde": { type: "string" },
    "estadia-hasta": { type: "string" },
    usos: { type: "string" },
    descripcion: { type: "string" },
    fecha: { type: "string" },
    turno: { type: "string" },
    capacidad: { type: "string" },
    valor: { type: "string" },
    servicio: { type: "string" },
  },
});

const [comando, sub, arg] = positionals;

function fallar(mensaje: string): never {
  console.error(mensaje);
  process.exitCode = 1;
  throw new SalidaControlada();
}

class SalidaControlada extends Error {}

function mostrarErrores(errores: Record<string, string[] | undefined>) {
  for (const [campo, msgs] of Object.entries(errores))
    console.error(`  ${campo}: ${msgs?.join(", ")}`);
}

async function ejecutar() {
  switch (comando) {
    case "reservar": {
      const r = await crearReservaAdmin({
        origen: o.tipo,
        llegada: o.llegada,
        salida: o.salida,
        motivo: o.motivo,
        nombre: o.nombre,
        correo: o.correo,
        telefono: o.telefono,
        huespedes: o.huespedes,
        tipoDocumento: o["tipo-documento"],
        documento: o.documento,
      });
      if (r.ok) {
        console.log(`Reserva ${r.codigo} confirmada (${o.tipo}, ${r.noches} noches, sin cobro).`);
        if (o.tipo !== "mantenimiento")
          console.log(
            `Envíale al beneficiario el enlace https://<tu-dominio>/reservas/confirmacion/${r.codigo}\n` +
              "Ahí ve su reserva y sube su documento de identidad.",
          );
        return;
      }
      if (r.error === "datos_invalidos") {
        console.error("Revisa los datos:");
        mostrarErrores(r.errores);
        fallar("");
      }
      if (r.error === "no_disponible") {
        console.error("Esas noches ya están ocupadas por:");
        console.table(r.choques);
        fallar("No se creó la reserva.");
      }
      if (r.error === "fechas_invalidas")
        fallar(
          "Fechas inválidas: la llegada no puede ser pasada y la salida va después (máximo 90 noches).",
        );
      fallar("Falta la fila de configuración en la BD (npm run db:seed:ejemplo en local).");
    }
    case "liberar": {
      if (!sub) fallar("Indica el código: npm run admin -- liberar LAU-XXXXXXXX");
      const r = await cancelarReservaAdmin(sub);
      if (r.ok) return console.log(`Reserva ${sub} cancelada: sus noches quedan libres.`);
      fallar(
        {
          no_encontrada: "No existe una reserva con ese código.",
          es_web:
            "Es una reserva pagada en el sitio: cancelarla requiere un reembolso; no se toca desde aquí.",
          no_confirmada: "Esa reserva ya no está confirmada (ya se había cancelado).",
        }[r.error],
      );
    }
    case "reservas": {
      const filas = await listarReservas(o.desde);
      if (filas.length === 0) return console.log("No hay reservas desde esa fecha.");
      return console.table(filas);
    }
    case "codigo": {
      if (sub === "crear") {
        const r = await crearCodigoDescuento({
          codigo: arg,
          porcentaje: o.porcentaje,
          validoDesde: o.desde,
          validoHasta: o.hasta,
          estadiaDesde: o["estadia-desde"],
          estadiaHasta: o["estadia-hasta"],
          usosMaximos: o.usos,
          descripcion: o.descripcion,
        });
        if (r.ok) return console.log(`Código ${r.codigo} creado (${o.porcentaje} %).`);
        if (r.error === "ya_existe") fallar("Ya existe un código con ese nombre.");
        console.error("Revisa los datos:");
        mostrarErrores(r.errores);
        fallar("");
      }
      if (sub === "desactivar") {
        if (!arg) fallar("Indica el código: npm run admin -- codigo desactivar PROMO15");
        if (await desactivarCodigoDescuento(arg)) return console.log(`Código ${arg} desactivado.`);
        fallar("No existe ese código.");
      }
      fallar(AYUDA);
    }
    case "codigos": {
      const filas = await listarCodigos();
      if (filas.length === 0) return console.log("Aún no hay códigos.");
      return console.table(
        filas.map((c) => ({
          codigo: c.codigo,
          porcentaje: `${c.porcentaje} %`,
          activo: c.activo,
          vigencia: `${c.validoDesde ?? "…"} a ${c.validoHasta ?? "…"}`,
          estadia: `${c.estadiaDesde ?? "…"} a ${c.estadiaHasta ?? "…"}`,
          usos: c.usosMaximos ? `${c.usos} de ${c.usosMaximos}` : String(c.usos),
        })),
      );
    }
    case "cabalgata": {
      if (!sub) {
        const cabalgatas = await listarServiciosCabalgata();
        if (cabalgatas.length === 0) fallar("No hay cabalgatas en la BD.");
        console.table(
          cabalgatas.map((s) => ({
            servicio: s.slug,
            nombre: s.nombre,
            activa: s.activo,
            caballos: s.capacidadTurno,
            turnos: s.turnos.join(", ") || "sin turnos",
            precio: `$${s.precio.toLocaleString("es-CO")} por caballo`,
          })),
        );
        const filas = await listarCabalgatas(o.desde);
        if (filas.length === 0) return console.log("No hay cabalgatas reservadas desde esa fecha.");
        return console.table(filas);
      }
      if (sub === "precio") {
        const r = await fijarPrecioCabalgata(o.servicio, o.valor);
        if (r.ok)
          return console.log(
            `${o.servicio}: $${Number(o.valor).toLocaleString("es-CO")} por caballo.`,
          );
        fallar(
          r.error === "sin_cabalgata"
            ? "No existe esa cabalgata (mira los slugs con: npm run admin -- cabalgata)."
            : "Indica --servicio cabalgata-… y --valor.",
        );
      }
      const entrada = {
        servicio: o.servicio,
        fecha: o.fecha,
        turno: o.turno,
        capacidad: o.capacidad,
      };
      let r: ResultadoCupoCabalgata;
      if (sub === "cerrar") {
        if (!o.fecha) fallar("Indica --fecha AAAA-MM-DD.");
        r = await fijarCapacidadCabalgata({ ...entrada, capacidad: 0 });
      } else if (sub === "capacidad") r = await fijarCapacidadCabalgata(entrada);
      else if (sub === "abrir") r = await abrirCabalgata(entrada);
      else fallar(AYUDA);
      if (!r.ok) {
        if (r.error === "datos_invalidos") {
          console.error("Revisa los datos:");
          mostrarErrores(r.errores);
          fallar("");
        }
        fallar(
          r.error === "sin_cabalgata"
            ? "No existe esa cabalgata (mira los slugs con: npm run admin -- cabalgata)."
            : "Ese turno no existe en la cabalgata.",
        );
      }
      const cuales = r.cabalgatas.join(" y ");
      const donde = o.fecha ? `el ${o.fecha}${o.turno ? ` (${o.turno})` : ""}` : "todos los días";
      console.log(
        sub === "cerrar"
          ? `${cuales}: cerrada ${donde}.`
          : sub === "abrir"
            ? `${cuales}: ${donde} vuelve a la capacidad de todos los días.`
            : `${cuales}: ${o.capacidad} caballos ${donde}.`,
      );
      if (r.afectadas.length > 0) {
        console.log("Ojo: estas reservas ya tienen cabalgata ese día y no se modificaron:");
        console.table(r.afectadas);
      }
      return;
    }
    default:
      console.log(AYUDA);
  }
}

try {
  await ejecutar();
} catch (error) {
  if (!(error instanceof SalidaControlada)) throw error;
} finally {
  if (process.env.DATABASE_URL) await getDb().$client.end();
}
