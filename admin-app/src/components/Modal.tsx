"use client";

import { X } from "lucide-react";

export default function Modal({
  title,
  onClose,
  disableOverlayClose = false,
  children,
}: {
  title: string;
  onClose: () => void;
  /** Para contenido que no debe cerrarse por accidente (p. ej. token único). */
  disableOverlayClose?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-tinta/50 p-4"
      onClick={disableOverlayClose ? undefined : onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-anden-lg bg-white p-6 shadow-anden-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-serif text-xl font-semibold text-tinta">{title}</h2>
          <button
            onClick={onClose}
            className="text-niebla transition hover:text-tinta"
            aria-label="Cerrar"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
