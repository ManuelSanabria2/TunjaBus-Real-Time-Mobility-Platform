// Tipos y helpers del módulo de Reportes (exportación CSV/PDF incluida).

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export interface ActivityRow {
  vehicle_id: string;
  vehicle_label: string;
  route_id: string | null;
  route_name: string | null;
  operator_id: string | null;
  operator_name: string | null;
  expected_minutes: number;
  active_minutes: number;
  activity_pct: number;
}

export interface CoverageRow {
  vehicle_id: string;
  vehicle_label: string;
  route_id: string | null;
  route_name: string | null;
  operator_id: string | null;
  operator_name: string | null;
  stop_id: string;
  stop_name: string;
  stop_sequence: number;
  visited: boolean;
  first_visited_at: string | null;
  last_visited_at: string | null;
}

/** "823 min" → "13 h 43 m" */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} m`;
  return `${h} h ${m} m`;
}

export function formatTimestamp(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("es-CO", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** YYYY-MM-DD local, `daysAgo` días atrás (0 = hoy). */
export function isoDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type CsvCell = string | number | boolean | null;

/**
 * CSV con separador ';' y BOM UTF-8: es lo que Excel en configuración
 * regional es-CO abre correctamente con acentos y columnas separadas.
 */
export function downloadCsv(
  filename: string,
  headers: string[],
  rows: CsvCell[][]
) {
  const escape = (value: CsvCell): string => {
    const s = value === null || value === undefined ? "" : String(value);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv =
    "﻿" +
    [headers, ...rows].map((r) => r.map(escape).join(";")).join("\n");
  triggerDownload(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
    filename
  );
}

interface PdfTable {
  title?: string;
  head: string[];
  body: (string | number)[][];
}

/** PDF con estilo Andén: encabezado tinta, acentos terracota. */
export function downloadPdf(options: {
  filename: string;
  title: string;
  subtitle: string;
  tables: PdfTable[];
}) {
  const doc = new jsPDF({ orientation: "landscape" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(28, 38, 50); // Tinta
  doc.text(options.title, 14, 16);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(140, 134, 126); // Niebla
  doc.text(options.subtitle, 14, 22);

  let y = 28;
  for (const table of options.tables) {
    if (table.title) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(181, 96, 58); // Terracota
      doc.text(table.title, 14, y);
      y += 4;
    }
    autoTable(doc, {
      startY: y,
      head: [table.head],
      body: table.body,
      styles: { fontSize: 8, textColor: [28, 38, 50] },
      headStyles: { fillColor: [28, 38, 50], textColor: [243, 239, 233] },
      alternateRowStyles: { fillColor: [243, 239, 233] },
      margin: { left: 14, right: 14 },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
      .finalY + 10;
  }

  doc.save(options.filename);
}
