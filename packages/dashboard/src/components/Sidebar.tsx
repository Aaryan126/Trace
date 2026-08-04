import { NavLink } from 'react-router-dom';
import { Icon, type IconName } from './Icon';

const NAV_ITEMS = [
  { to: '/activity', label: 'Activity', detail: 'Commits and revisits', icon: 'activity' },
  { to: '/threads', label: 'Decisions', detail: 'Threads and branches', icon: 'branch' },
  { to: '/capture', label: 'Live Trace', detail: 'Automatic routing', icon: 'capture' },
] satisfies Array<{ to: string; label: string; detail: string; icon: IconName }>;

interface SidebarProps {
  unreadCount?: number;
}

export function Sidebar({ unreadCount = 0 }: SidebarProps) {
  return (
    <aside className="border-b border-[#21262d] bg-[#090d13] lg:flex lg:h-screen lg:w-64 lg:shrink-0 lg:flex-col lg:border-b-0 lg:border-r">
      <div className="flex items-center justify-between border-b border-[#21262d] px-4 py-4 lg:block lg:px-5 lg:py-5">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#3fb950]/30 bg-[#3fb950]/10 text-[#3fb950] shadow-[0_0_24px_rgba(63,185,80,0.08)]">
            <Icon name="branch" className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-[#f0f6fc]">Trace</h1>
            <p className="mono text-[10px] uppercase tracking-widest text-[#6e7681]">decision history</p>
          </div>
        </div>
        <span className="mono rounded border border-[#30363d] px-1.5 py-0.5 text-[10px] text-[#8b949e] lg:hidden">local</span>
      </div>
      <nav className="flex gap-1 overflow-x-auto p-2 lg:flex-1 lg:flex-col lg:space-y-1 lg:overflow-visible lg:px-3 lg:py-4">
        {NAV_ITEMS.map(({ to, label, detail, icon }) => (
          <NavLink
            key={to}
            to={to}
            end
            className={({ isActive }) =>
              `group flex min-w-max items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors lg:min-w-0 ${
                isActive
                  ? 'border-[#30363d] bg-[#161b22] text-[#e6edf3] shadow-sm'
                  : 'border-transparent text-[#8b949e] hover:border-[#21262d] hover:bg-[#11161d] hover:text-[#e6edf3]'
              }`
            }
          >
            <Icon name={icon} className="h-[18px] w-[18px] shrink-0" />
            <span className="min-w-0">
              <span className="block font-medium leading-5">{label}</span>
              <span className="hidden truncate text-[11px] font-normal leading-4 text-[#6e7681] lg:block">{detail}</span>
            </span>
            {label === 'Activity' && unreadCount > 0 && (
              <span className="ml-auto rounded-full bg-[#58a6ff]/15 text-[#58a6ff] border border-[#58a6ff]/30 px-1.5 py-0.5 text-xs font-medium">
                {unreadCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="hidden border-t border-[#21262d] px-5 py-4 lg:block">
        <div className="flex items-center gap-2 text-xs text-[#8b949e]">
          <span className="h-2 w-2 rounded-full bg-[#3fb950] shadow-[0_0_8px_rgba(63,185,80,0.55)]" />
          Local-first workspace
        </div>
        <p className="mono mt-1.5 text-[10px] text-[#484f58]">SQLite · localhost only</p>
      </div>
    </aside>
  );
}
