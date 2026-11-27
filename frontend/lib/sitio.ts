// Datos del negocio que se muestran en header, footer y botón de WhatsApp.
// TODO(cliente): confirmar número de WhatsApp, correo e Instagram antes de publicar.
// RNT: certificado de la Cámara de Comercio de Manizales, vence el 31 de marzo de 2027.
export const sitio = {
  nombre: "Lauburu Glamping",
  descriptiva: "GLAMPING · MANIZALES",
  direccion: "Vereda Cuchilla del Salado, Manizales, Caldas",
  whatsapp: "570000000000", // formato internacional sin "+" ni espacios
  correo: "lauburuglamping@gmail.com",
  instagram: "https://www.instagram.com/",
  rnt: "307689",
} as const;

// Las 2 vistas de la propuesta. "Reservar" es el botón primario del header.
export const navegacion = [{ href: "/", texto: "Nosotros" }] as const;

// Secciones de la página Nosotros (anclas en "/").
export const secciones = [
  { href: "/#alojamiento", texto: "El alojamiento" },
  { href: "/#tarifas", texto: "Tarifas y temporadas" },
  { href: "/#experiencias", texto: "Experiencias" },
  { href: "/#galeria", texto: "Galería" },
  { href: "/#como-llegar", texto: "Cómo llegar" },
  { href: "/#preguntas-frecuentes", texto: "Preguntas frecuentes" },
] as const;

export function enlaceWhatsApp(texto = "Hola, quiero información sobre Lauburu Glamping") {
  return `https://wa.me/${sitio.whatsapp}?text=${encodeURIComponent(texto)}`;
}

// TODO(cliente): usar coordenadas exactas del glamping en lugar de la dirección.
export function enlaceMapa() {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(sitio.direccion)}`;
}

export function enlaceWaze() {
  return `https://waze.com/ul?q=${encodeURIComponent(sitio.direccion)}&navigate=yes`;
}
