import type { SVGProps } from 'react';

export type IconName =
  | 'activity'
  | 'branch'
  | 'capture'
  | 'check'
  | 'commit'
  | 'filter'
  | 'merge'
  | 'revisit'
  | 'search';

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  const paths: Record<IconName, React.ReactNode> = {
    activity: <><path d="M3 12h4l2.5-7 5 14 2.5-7h4" /></>,
    branch: <><circle cx="6" cy="5" r="2" /><circle cx="18" cy="7" r="2" /><circle cx="6" cy="19" r="2" /><path d="M6 7v10M8 11h3a7 7 0 0 0 7-2" /></>,
    capture: <><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" /><circle cx="12" cy="12" r="3" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    commit: <><circle cx="12" cy="12" r="3" /><path d="M3 12h6M15 12h6" /></>,
    filter: <><path d="M4 5h16M7 12h10M10 19h4" /></>,
    merge: <><circle cx="7" cy="5" r="2" /><circle cx="17" cy="5" r="2" /><circle cx="12" cy="19" r="2" /><path d="M7 7v2a6 6 0 0 0 5 6M17 7v2a6 6 0 0 1-5 6" /></>,
    revisit: <><path d="M4 4v6h6M20 20v-6h-6" /><path d="M5.5 15a8 8 0 0 0 13-3M18.5 9a8 8 0 0 0-13 3" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  };

  return <svg {...common} {...props}>{paths[name]}</svg>;
}
