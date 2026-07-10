import { useEffect, useState } from 'react';
import { useI18n } from '../../contexts/I18nContext';
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
  hint: string;
  checked: boolean;
  onToggle: () => void;
}> = ({ label, hint, checked, onToggle }) => (
  <div className="flex items-start justify-between gap-4">
    <div className="min-w-0">
      <p className="text-sm font-semibold text-foreground"><Typo>{label}</Typo></p>
      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground"><Typo>{hint}</Typo></p>
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className={cn(
        'relative mt-0.5 h-6 w-10 shrink-0 cursor-pointer rounded-full transition-colors',
        checked ? 'bg-foreground' : 'bg-muted-foreground/25'
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-0.5 size-5 rounded-full bg-background shadow-sm transition-all',
          checked ? 'left-[calc(100%-1.375rem)]' : 'left-0.5'
        )}
      />
    </button>
  </div>
);

const Segmented: React.FC<{
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}> = ({ label, value, options, onChange }) => (
  <div>
    <p className="mb-2 text-sm font-semibold text-foreground"><Typo>{label}</Typo></p>
    <div role="radiogroup" aria-label={label} className="flex rounded-full border border-border bg-muted/40 p-1">
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
              'flex-1 cursor-pointer rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
              active
                ? 'bg-foreground text-background shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Typo>{option.label}</Typo>
          </button>
        );
      })}
    </div>
  </div>
);

/**
 * A tab pinned to the right edge of the viewport that opens a non-modal panel
 * for playing with the live editor's settings on the /demo playground.
 */
export const SettingsPanel: React.FC<SettingsPanelProps> = ({ settings, onSettingsChange }) => {
  const { t } = useI18n();
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

  if (!open) {
    return (
      <button
        type="button"
        aria-label={t('demo.settings.openAriaLabel')}
        onClick={() => setOpen(true)}
        className="fixed right-0 top-1/2 z-40 flex -translate-y-1/2 cursor-pointer flex-col items-center gap-2 rounded-l-2xl border border-r-0 border-border bg-card px-2.5 py-4 text-muted-foreground shadow-card transition-colors hover:text-foreground"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        <span className="text-[0.7rem] font-bold uppercase tracking-widest" style={{ writingMode: 'vertical-rl' }}>
          <Typo>{t('demo.settings.tabLabel')}</Typo>
        </span>
      </button>
    );
  }

  return (
    <aside
      aria-label={t('demo.settings.title')}
      className="fixed inset-y-0 right-0 z-40 flex w-[21.5rem] max-w-[88vw] flex-col border-l border-border bg-card shadow-2xl"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-foreground"><Typo>{t('demo.settings.title')}</Typo></h2>
          <p className="mt-0.5 text-xs text-muted-foreground"><Typo>{t('demo.settings.subtitle')}</Typo></p>
        </div>
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
          hint={t('demo.settings.readOnlyHint')}
          checked={settings.readOnly}
          onToggle={() => patch({ readOnly: !settings.readOnly })}
        />
        <SwitchRow
          label={t('demo.settings.autofocusLabel')}
          hint={t('demo.settings.autofocusHint')}
          checked={settings.autofocus}
          onToggle={() => patch({ autofocus: !settings.autofocus })}
        />
        <SwitchRow
          label={t('demo.settings.hideToolbarLabel')}
          hint={t('demo.settings.hideToolbarHint')}
          checked={settings.hideToolbar}
          onToggle={() => patch({ hideToolbar: !settings.hideToolbar })}
        />

        <Segmented
          label={t('demo.settings.themeLabel')}
          value={settings.theme}
          options={[
            { value: 'site', label: t('demo.settings.themeSite') },
            { value: 'light', label: t('demo.settings.themeLight') },
            { value: 'dark', label: t('demo.settings.themeDark') },
          ]}
          onChange={value => patch({ theme: value as EditorSettings['theme'] })}
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
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          <Typo>{t('demo.settings.recreateNote')}</Typo>
        </p>
      </div>
    </aside>
  );
};
