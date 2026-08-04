import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: IconName;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="panel flex min-h-56 flex-col items-center justify-center px-6 py-10 text-center">
      <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-[#30363d] bg-[#0d1117] text-[#58a6ff]">
        <Icon name={icon} />
      </span>
      <h3 className="text-sm font-semibold text-[#e6edf3]">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-[#8b949e]">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
