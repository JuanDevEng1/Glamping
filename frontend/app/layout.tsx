import type { Metadata } from "next";
import { Lora, Poppins } from "next/font/google";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { trmParaCobro } from "@lauburu/backend/moneda";
import { MonedaProvider } from "@/components/Moneda";
import { CarritoProvider } from "@/components/servicios/Carrito";
import { WhatsAppButton } from "@/components/WhatsAppButton";
import "./globals.css";

// Páginas estáticas que se regeneran cada hora (configuración de precios y TRM).
export const revalidate = 3600;

const lora = Lora({
  subsets: ["latin"],
  weight: ["400", "600"],
  style: ["normal", "italic"],
  variable: "--font-lora",
  display: "swap",
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://lauburu.co"),
  title: {
    default: "Lauburu Glamping · Manizales",
    template: "%s · Lauburu Glamping",
  },
  description: "Glamping en las montañas de Manizales, Caldas. Un refugio para hasta 6 personas.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const trm = await trmParaCobro();
  return (
    <html lang="es" className={`${lora.variable} ${poppins.variable}`}>
      <body className="flex min-h-svh flex-col font-sans text-body antialiased">
        <a
          href="#contenido"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[60] focus:rounded-full focus:bg-crema focus:px-6 focus:py-3 focus:text-verde"
        >
          Saltar al contenido
        </a>
        <MonedaProvider trm={trm}>
          <CarritoProvider>
            <Header />
            <main id="contenido" className="flex-1">
              {children}
            </main>
            <Footer />
            <WhatsAppButton />
          </CarritoProvider>
        </MonedaProvider>
      </body>
    </html>
  );
}
