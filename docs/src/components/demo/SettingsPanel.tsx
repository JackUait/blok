import { useEffect, useState } from 'react';
import { useI18n } from '../../contexts/I18nContext';
import { useTheme, type Theme } from '../../hooks/useTheme';
import { Typo } from '../common/Typo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { DEFAULT_EDITOR_SETTINGS, type EditorSettings } from './editor-settings';

interface SettingsPanelProps {
  settings: EditorSettings;
  onSettingsChange: (settings: EditorSettings) => void;
}

const SwitchRow: React.FC<{
  label: string;
  checked: boolean;
  onToggle: () => void;
}> = ({ label, checked, onToggle }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={onToggle}
    className="flex w-full cursor-pointer items-center justify-between gap-4 text-left"
  >
    <span className="min-w-0 text-sm font-semibold text-foreground"><Typo>{label}</Typo></span>
    <span
      aria-hidden="true"
      className={cn(
        'relative h-6 w-10 shrink-0 rounded-full transition-colors',
        checked ? 'bg-foreground' : 'bg-muted-foreground/25'
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 size-5 rounded-full bg-background shadow-sm transition-all',
          checked ? 'left-[calc(100%-1.375rem)]' : 'left-0.5'
        )}
      />
    </span>
  </button>
);

const Segmented: React.FC<{
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}> = ({ label, value, options, onChange }) => {
  const activeIndex = Math.max(0, options.findIndex(option => option.value === value));

  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-foreground"><Typo>{label}</Typo></p>
      <div role="radiogroup" aria-label={label} className="relative flex rounded-full border border-border bg-muted/40 p-1">
        <span
          aria-hidden="true"
          data-blok-testid="segmented-thumb"
          className="absolute inset-y-1 left-1 rounded-full bg-foreground shadow-sm transition-transform duration-300 ease-out"
          style={{
            width: `calc((100% - 0.5rem) / ${options.length})`,
            transform: `translateX(${activeIndex * 100}%)`,
          }}
        />
        {options.map(option => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(option.value)}
              className={cn(
                'relative flex-1 cursor-pointer rounded-full px-3 py-1.5 text-xs font-semibold transition-colors duration-300',
                active ? 'text-background' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Typo>{option.label}</Typo>
            </button>
          );
        })}
      </div>
    </div>
  );
};

/**
 * A tab pinned to the right edge of the viewport that opens a non-modal panel
 * for playing with the live editor's settings on the /demo playground.
 */
export const SettingsPanel: React.FC<SettingsPanelProps> = ({ settings, onSettingsChange }) => {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);

  const patch = (partial: Partial<EditorSettings>) =>
    onSettingsChange({ ...settings, ...partial });

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        data-blok-testid="demo-settings-tab"
        aria-label={t('demo.settings.openAriaLabel')}
        aria-hidden={open ? true : undefined}
        inert={open}
        onClick={() => setOpen(true)}
        className={cn(
          'fixed right-0 top-1/2 z-40 flex -translate-y-1/2 cursor-pointer flex-col items-center gap-2 rounded-l-2xl border border-r-0 border-border bg-card px-2.5 py-4 text-muted-foreground shadow-card transition-[translate,opacity,color] duration-300 ease-out hover:text-foreground',
          open ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'
        )}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        <span className="text-[0.7rem] font-bold uppercase tracking-widest" style={{ writingMode: 'vertical-rl' }}>
          <Typo>{t('demo.settings.tabLabel')}</Typo>
        </span>
      </button>

      <aside
        data-blok-testid="demo-settings-panel"
        aria-label={t('demo.settings.title')}
        aria-hidden={open ? undefined : true}
        inert={!open}
        className={cn(
          'fixed inset-y-3 right-3 z-40 flex w-[21.5rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-2xl transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : 'translate-x-[calc(100%+0.75rem)]'
        )}
      >
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-5 py-4">
        <h2 className="min-w-0 text-sm font-bold text-foreground"><Typo>{t('demo.settings.title')}</Typo></h2>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setOpen(false)}
          aria-label={t('demo.settings.closeAriaLabel')}
          title={t('demo.settings.closeAriaLabel')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
        <SwitchRow
          label={t('demo.settings.readOnlyLabel')}
          checked={settings.readOnly}
          onToggle={() => patch({ readOnly: !settings.readOnly })}
        />
        <SwitchRow
          label={t('demo.settings.autofocusLabel')}
          checked={settings.autofocus}
          onToggle={() => patch({ autofocus: !settings.autofocus })}
        />
        <SwitchRow
          label={t('demo.settings.hideToolbarLabel')}
          checked={settings.hideToolbar}
          onToggle={() => patch({ hideToolbar: !settings.hideToolbar })}
        />

        <Segmented
          label={t('demo.settings.themeLabel')}
          value={theme}
          options={[
            { value: 'light', label: t('demo.settings.themeLight') },
            { value: 'dark', label: t('demo.settings.themeDark') },
          ]}
          onChange={value => setTheme(value as Theme)}
        />
        <Segmented
          label={t('demo.settings.widthLabel')}
          value={settings.width}
          options={[
            { value: 'narrow', label: t('demo.settings.widthNarrow') },
            { value: 'full', label: t('demo.settings.widthFull') },
          ]}
          onChange={value => patch({ width: value as EditorSettings['width'] })}
        />
        <Segmented
          label={t('demo.settings.alignLabel')}
          value={settings.contentAlign}
          options={[
            { value: 'left', label: t('demo.settings.alignLeft') },
            { value: 'center', label: t('demo.settings.alignCenter') },
            { value: 'right', label: t('demo.settings.alignRight') },
          ]}
          onChange={value => patch({ contentAlign: value as EditorSettings['contentAlign'] })}
        />

        <div>
          <label htmlFor="demo-settings-placeholder" className="mb-2 block text-sm font-semibold text-foreground">
            <Typo>{t('demo.settings.placeholderLabel')}</Typo>
          </label>
          <Input
            id="demo-settings-placeholder"
            value={settings.placeholder}
            placeholder={t('demo.settings.placeholderInputPlaceholder')}
            onChange={event => patch({ placeholder: event.target.value })}
          />
        </div>
      </div>

      <div className="border-t border-border px-5 py-4">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          aria-label={t('demo.settings.resetLabel')}
          onClick={() => onSettingsChange(DEFAULT_EDITOR_SETTINGS)}
        >
          <Typo>{t('demo.settings.resetLabel')}</Typo>
        </Button>
      </div>
      </aside>
    </>
  );
};
