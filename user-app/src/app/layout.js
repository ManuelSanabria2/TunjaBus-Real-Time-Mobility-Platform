import "./globals.css";

export const metadata = {
  title: "Andén — Transporte en Tiempo Real",
  description: "Rastrea los buses de Tunja en tiempo real. Encuentra tu ruta, calcula el tiempo de llegada y navega la ciudad con Andén.",
  keywords: "tunja, bus, transporte, andén, tiempo real, ruta, GPS, tracking",
  openGraph: {
    title: "Andén — Transporte en Tiempo Real",
    description: "Rastrea los buses de Tunja en tiempo real.",
    type: "website",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#F3EFE9",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
