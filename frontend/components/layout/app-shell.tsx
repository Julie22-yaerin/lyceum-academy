export function AppShell({
  eyebrow,
  title,
  actions,
  children
}: {
  eyebrow?: string;
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div>
          {eyebrow ? <p className="text-sm uppercase tracking-[0.2em] text-sky-400/80">{eyebrow}</p> : null}
          <h1 className="mt-3 text-3xl font-semibold text-white">{title}</h1>
        </div>
        {actions ? <div className="flex items-center gap-3">{actions}</div> : null}
      </header>
      <main className="mt-10">{children}</main>
    </div>
  );
}
