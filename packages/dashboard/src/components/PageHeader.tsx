import type { ReactNode } from 'react';

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <p className="mono mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#3fb950]">
          {eyebrow}
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-[#f0f6fc]">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-[#8b949e]">{description}</p>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
