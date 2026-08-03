interface StatusBadgeProps {
  status: 'open' | 'closed';
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const isOpen = status === 'open';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        isOpen
          ? 'bg-[#3fb950]/15 text-[#3fb950] border border-[#3fb950]/30'
          : 'bg-[#f85149]/15 text-[#f85149] border border-[#f85149]/30'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isOpen ? 'bg-[#3fb950]' : 'bg-[#f85149]'}`} />
      {status}
    </span>
  );
}
