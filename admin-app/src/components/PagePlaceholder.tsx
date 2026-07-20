// Stub de contenido para las secciones del panel mientras no tienen lógica.
export default function PagePlaceholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <h1 className="mb-1 font-serif text-3xl font-semibold text-tinta">
        {title}
      </h1>
      <p className="mb-8 text-sm text-niebla">{description}</p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-anden-lg border border-dashed border-niebla/40 bg-white/60 p-8 text-center"
          >
            <p className="text-sm font-medium text-niebla">Próximamente</p>
          </div>
        ))}
      </div>
    </div>
  );
}
