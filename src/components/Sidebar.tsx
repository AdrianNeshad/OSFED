import { SECTIONS, GROUP_ORDER, type SectionId } from '../lib/sections';
import type { BackupInfo } from '../lib/types';
import { APP_VERSION } from '../lib/version';
import { ShieldCheck, Lock } from 'lucide-react';

interface Props {
  current: SectionId;
  onSelect: (id: SectionId) => void;
  backup: BackupInfo | null;
}

export default function Sidebar({ current, onSelect, backup }: Props) {
  return (
    <aside className="w-[232px] shrink-0 h-full flex flex-col bg-sidebar border-r border-border-subtle">
      {/* brand / titlebar drag area — pushed down so the logo clears the
          macOS traffic-light window buttons in the top-left corner. */}
      <div className="titlebar-drag flex items-center gap-2 px-4 pt-8 pb-3">
        <div className="titlebar-no-drag flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-accent/20 border border-accent/40 flex items-center justify-center">
            <ShieldCheck size={15} className="text-accent" />
          </div>
          <span className="font-semibold tracking-tight text-[15px]">OSFED</span>
          <span className="text-caption text-text-tertiary mono mt-0.5">v{APP_VERSION}</span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {GROUP_ORDER.map((group) => {
          const items = SECTIONS.filter((s) => s.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group} className="mb-4">
              <div className="px-3 mb-1 text-caption uppercase tracking-wider text-text-tertiary">{group}</div>
              <div className="space-y-0.5">
                {items.map((s) => {
                  const disabled = s.needsBackup && !backup;
                  const active = current === s.id;
                  const Icon = s.icon;
                  return (
                    <button
                      key={s.id}
                      disabled={disabled}
                      onClick={() => onSelect(s.id)}
                      className={[
                        'w-full flex items-center gap-2.5 px-3 py-[7px] rounded-md text-[13px] text-left transition-colors',
                        active
                          ? 'bg-sidebar-active text-text-primary'
                          : disabled
                          ? 'text-text-tertiary/50 cursor-not-allowed'
                          : 'text-text-secondary hover:bg-sidebar-active/60 hover:text-text-primary',
                      ].join(' ')}
                    >
                      <Icon size={16} className={active ? 'text-accent' : ''} />
                      <span className="flex-1 truncate">{s.label}</span>
                      {disabled && <Lock size={12} className="opacity-40" />}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* footer: current backup */}
      <div className="px-3 py-3 border-t border-border-subtle">
        {backup ? (
          <div className="text-caption">
            <div className="flex items-center gap-1.5 text-text-secondary">
              <span className={`w-2 h-2 rounded-full ${backup.encrypted ? 'bg-success' : 'bg-warning'}`} />
              <span className="truncate font-medium text-text-primary">{backup.deviceName || backup.name}</span>
            </div>
            <div className="text-text-tertiary mt-0.5 truncate">
              {backup.encrypted ? 'Encrypted' : 'Unencrypted'} · iOS {backup.productVersion || '?'}
            </div>
          </div>
        ) : (
          <div className="text-caption text-text-tertiary">No backup loaded</div>
        )}
      </div>
    </aside>
  );
}
