import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Andén Admin",
  description:
    "Panel de administración de TunjaBus para cooperativas y Secretaría de Movilidad",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
