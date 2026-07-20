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
  icons: {
    icon: '/icon-pasajeros.svg',
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
      <body>
        {children}
        <div style={{ position: 'fixed', bottom: '8px', width: '100%', textAlign: 'center', fontSize: '11px', color: '#666', opacity: 0.6, pointerEvents: 'none', zIndex: 9999 }}>
          hecho por manuel jose sanabria gil
        </div>
      </body>
    </html>
  );
}
