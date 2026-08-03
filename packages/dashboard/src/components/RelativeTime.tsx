export function RelativeTime({ date }: { date: string }) {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diff = now - then;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  let display: string;
  if (seconds < 60) display = 'just now';
  else if (minutes < 60) display = `${minutes}m ago`;
  else if (hours < 24) display = `${hours}h ago`;
  else if (days < 30) display = `${days}d ago`;
  else display = new Date(date).toLocaleDateString();

  return <span className="mono text-[#8b949e] text-sm" title={new Date(date).toLocaleString()}>{display}</span>;
}
