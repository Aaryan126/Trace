import { Icon, type IconName } from './Icon';

const STAGES: Array<{ id: string; label: string; detail: string; icon: IconName }> = [
  { id: 'capture', label: 'Capture', detail: 'Pages and screenshots', icon: 'capture' },
  { id: 'curate', label: 'Curate', detail: 'Ignore noise, group evidence', icon: 'filter' },
  { id: 'commit', label: 'Commit', detail: 'Save verdict and reasoning', icon: 'commit' },
  { id: 'revisit', label: 'Revisit', detail: 'Branch when context changes', icon: 'revisit' },
];

export function DecisionFlow({ activeStage }: { activeStage?: string }) {
  return (
    <section className="panel-soft p-4 sm:p-5" aria-label="How Trace works">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[#e6edf3]">Decision lifecycle</p>
          <p className="mt-0.5 text-xs text-[#8b949e]">A git-style history for choices, not pages.</p>
        </div>
        <span className="mono rounded-full border border-[#30363d] bg-[#0d1117] px-2 py-1 text-[10px] uppercase tracking-wider text-[#8b949e]">
          evidence → verdict
        </span>
      </div>
      <ol className="grid gap-2 md:grid-cols-4">
        {STAGES.map((stage, index) => {
          const active = activeStage === stage.id;
          return (
            <li key={stage.id} className="relative flex items-center gap-3">
              <div className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg border px-3 py-3 ${
                active
                  ? 'border-[#3fb950]/50 bg-[#3fb950]/10'
                  : 'border-[#30363d] bg-[#0d1117]/70'
              }`}>
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${
                  active
                    ? 'border-[#3fb950]/50 bg-[#3fb950]/15 text-[#3fb950]'
                    : 'border-[#30363d] bg-[#161b22] text-[#8b949e]'
                }`}>
                  <Icon name={stage.icon} className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-[#e6edf3]">{index + 1}. {stage.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-[#8b949e]">{stage.detail}</span>
                </span>
              </div>
              {index < STAGES.length - 1 && (
                <span className="absolute -right-2 z-10 hidden h-px w-2 bg-[#484f58] md:block" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
