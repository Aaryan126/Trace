import { NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/', label: 'Feed', icon: '⚡' },
  { to: '/threads', label: 'Threads', icon: '◆' },
  { to: '/capture', label: 'Capture', icon: '◎' },
];

interface SidebarProps {
  unreadCount?: number;
}

export function Sidebar({ unreadCount = 0 }: SidebarProps) {
  return (
    <aside className="flex h-screen w-56 flex-col border-r border-[#30363d] bg-[#0d1117]">
      <div className="border-b border-[#30363d] px-4 py-4">
        <h1 className="text-base font-bold text-[#e6edf3] tracking-tight">
          <span className="text-[#3fb950]">▸</span> Brainch
        </h1>
      </div>
      <nav className="flex-1 px-2 py-3 space-y-1">
        {NAV_ITEMS.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                isActive
                  ? 'bg-[#161b22] text-[#e6edf3] border border-[#30363d]'
                  : 'text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#161b22]/50 border border-transparent'
              }`
            }
          >
            <span className="text-base leading-none">{icon}</span>
            <span>{label}</span>
            {label === 'Feed' && unreadCount > 0 && (
              <span className="ml-auto rounded-full bg-[#58a6ff]/15 text-[#58a6ff] border border-[#58a6ff]/30 px-1.5 py-0.5 text-xs font-medium">
                {unreadCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-[#30363d] px-4 py-3">
        <p className="text-xs text-[#8b949e] mono">v0.1.0</p>
      </div>
    </aside>
  );
}
