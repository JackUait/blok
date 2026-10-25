import type { I18n } from '../../../types';
import { IconCross, IconDotsHorizontal, IconTrash } from '../../components/icons';
import { openModalDialog } from '../../components/utils/modal-dialog';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import { openDatabaseConfirm } from './database-confirm-dialog';
import { panelLabel, panelRow, panelSwitch } from './database-panel';
import { openMenu } from './database-table-menus';
import type { AutofillMode, AutofillSettings, PropertyDefinition } from './types';

export { offersAutofill } from './property-values';

const counter = { next: 0 };

/** The unsaved Basic setup of one property. */
export interface AutofillDraft {
  mode: AutofillMode;
  instruction: string;
  language?: string;
  onCreate: boolean;
  onEdit: boolean;
  /** With `onEdit`: only these properties fill again. Absent: any property. */
  onEditProperties?: string[];
  onEditContent: boolean;
}

export const draftOf = (settings: AutofillSettings | undefined): AutofillDraft => ({
  mode: settings?.mode ?? 'custom',
  instruction: settings?.instruction ?? '',
  ...(settings?.language !== undefined ? { language: settings.language } : {}),
  onCreate: settings?.onCreate === true,
  onEdit: settings?.onEdit === true,
  ...(settings?.onEdit === true && settings.onEditProperties !== undefined ? { onEditProperties: [...settings.onEditProperties] } : {}),
  onEditContent: settings?.onEditContent === true,
});

const settingsOf = (draft: AutofillDraft): AutofillSettings => ({
  mode: draft.mode,
  ...(draft.instruction.trim() !== '' ? { instruction: draft.instruction.trim() } : {}),
  ...(draft.language !== undefined ? { language: draft.language } : {}),
  ...(draft.onCreate ? { onCreate: true } : {}),
  ...(draft.onEdit ? { onEdit: true } : {}),
  ...(draft.onEdit && draft.onEditProperties !== undefined ? { onEditProperties: draft.onEditProperties } : {}),
  ...(draft.onEditContent ? { onEditContent: true } : {}),
});

const sameDraft = (a: AutofillDraft, b: AutofillDraft): boolean =>
  JSON.stringify(settingsOf(a)) === JSON.stringify(settingsOf(b));

/** A preset mode needs no instruction (the host knows it); a custom one does. */
const runnable = (draft: AutofillDraft): boolean => draft.mode !== 'custom' || draft.instruction.trim() !== '';

export interface AutofillSetupOptions {
  i18n: Pick<I18n, 't' | 'getLocale'>;
  /** The saved property, read again on every check. */
  property: () => PropertyDefinition | undefined;
  /** Shown name: may be localized. */
  name: string;
  draft: AutofillDraft | undefined;
  /** Keeps the draft for the next open, or forgets it with undefined. */
  onDraft: (draft: AutofillDraft | undefined) => void;
  writable: () => boolean;
  hasRows: () => boolean;
  /** Properties an edit of which can fill again: every other one of the database. */
  triggerProperties: () => Array<{ id: string; name: string }>;
  onSave: (settings: AutofillSettings) => void;
  /** "Delete AI Autofill": drops the saved setting. */
  onDelete: () => void;
  onGenerate: (settings: AutofillSettings) => void;
  onRunNow: () => void;
  onClose: () => void;
  directionSource?: Element | null;
}

// ku.json is Sorani (Arabic script), but Intl reads 'ku' as Kurmanji.
const LANGUAGE_TAGS: Readonly<Record<string, string>> = { ku: 'ckb' };

const languageTag = (locale: string): string => LANGUAGE_TAGS[locale] ?? locale;

/** "A, B" in the UI's language. */
const listOf = (parts: string[], uiLocale: string): string => {
  try {
    return new Intl.ListFormat([languageTag(uiLocale)], { type: 'unit', style: 'short' }).format(parts);
  } catch {
    return parts.join(', ');
  }
};

/** The language `tag`, named in the UI's language so the prompt reads as one language. */
export const languageName = (tag: string, uiLocale: string): string => {
  try {
    return new Intl.DisplayNames([languageTag(uiLocale)], { type: 'language' }).of(languageTag(tag)) ?? tag;
  } catch {
    return tag;
  }
};

/** A preset's mode, language and prompt: Translate into the UI's language, or a one-paragraph summary. */
export const presetDraft = (
  mode: 'translate' | 'summary',
  i18n: Pick<I18n, 't' | 'getLocale'>
): Pick<AutofillDraft, 'mode' | 'language' | 'instruction'> => {
  if (mode === 'summary') return { mode, instruction: i18n.t('tools.database.aiAutofillParagraphPrompt') };
  const locale = i18n.getLocale();
  const language = languageTag(locale);

  return { mode, language, instruction: i18n.t('tools.database.aiAutofillTranslatePrompt', { language: languageName(language, locale) }) };
};

/**
 * The AI Autofill setup, Basic tab. It edits a draft only; Save writes
 * `property.autofill`, and Generate and Run go through `config.ai.autofill`.
 */
export const openAutofillSetup = (options: AutofillSetupOptions): { close: () => void } => {
  const { i18n } = options;
  const saved = (): AutofillDraft => draftOf(options.property()?.autofill);
  const state = { draft: options.draft ?? saved(), closed: false };
  const backdrop = document.createElement('div');
  const panel = document.createElement('div');
  const header = document.createElement('div');
  const title = document.createElement('div');
  const close = document.createElement('button');
  const more = document.createElement('button');
  const tabs = document.createElement('div');
  const tab = document.createElement('button');
  const field = document.createElement('textarea');
  const presets = document.createElement('div');
  const footer = document.createElement('div');

  backdrop.setAttribute('data-blok-database-confirm', '');
  // Mounted on body: the popover scope brings the editor font and preflight.
  backdrop.setAttribute('data-blok-popover', '');
  panel.setAttribute('data-blok-database-autofill-setup', '');
  header.setAttribute('data-blok-database-autofill-header', '');
  counter.next += 1;
  title.id = `blok-database-autofill-title-${counter.next}`;
  title.textContent = i18n.t('tools.database.aiAutofillProperty', { name: options.name });
  close.type = 'button';
  close.setAttribute('data-blok-database-autofill-close', '');
  close.setAttribute('aria-label', i18n.t('tools.database.aiAutofillClose'));
  close.innerHTML = IconCross;
  more.type = 'button';
  more.setAttribute('data-blok-database-autofill-more', '');
  more.setAttribute('aria-label', i18n.t('tools.database.aiAutofillMore'));
  more.innerHTML = IconDotsHorizontal;
  header.append(title, more, close);

  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('data-blok-database-autofill-tabs', '');
  tab.type = 'button';
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-selected', 'true');
  tab.setAttribute('data-blok-database-autofill-tab', '');
  tab.textContent = i18n.t('tools.database.aiAutofillBasic');
  tabs.appendChild(tab);

  field.setAttribute('aria-label', i18n.t('tools.database.aiAutofillInstructions'));
  field.setAttribute('data-blok-database-autofill-instructions', '');
  field.rows = 4;
  field.value = state.draft.instruction;

  presets.setAttribute('data-blok-database-autofill-presets', '');
  footer.setAttribute('data-blok-database-autofill-footer', '');

  const button = (parent: HTMLElement, label: string, onClick: (el: HTMLButtonElement) => void): HTMLButtonElement => {
    const el = document.createElement('button');

    el.type = 'button';
    el.setAttribute('data-blok-database-autofill-action', '');
    el.textContent = label;
    el.addEventListener('click', () => onClick(el));
    parent.appendChild(el);

    return el;
  };

  const update = (patch: Partial<AutofillDraft>): void => {
    state.draft = { ...state.draft, ...patch };
    if (patch.instruction !== undefined && field.value !== patch.instruction) field.value = patch.instruction;
    sync();
  };

  // Focus left in the removed menu would fall to body. Focus already back in the panel stays put.
  const menu = (anchor: HTMLElement, items: Parameters<typeof openMenu>[1]): void => {
    openMenu(anchor, items, {
      onClose: () => {
        if (!panel.contains(document.activeElement)) anchor.focus({ preventScroll: true });
      },
    });
  };

  button(presets, i18n.t('tools.database.aiAutofillTranslate'), () => {
    update(presetDraft('translate', i18n));
  });
  button(presets, i18n.t('tools.database.aiAutofillSummarize'), (el) => {
    menu(el, [{
      type: PopoverItemType.Default,
      name: 'database-autofill-summary-paragraph',
      title: i18n.t('tools.database.aiAutofillParagraph'),
      closeOnActivate: true,
      onActivate: () => update({ ...presetDraft('summary', i18n), language: undefined }),
    }]);
  });

  /** Notion's trigger choices (research/12 §2). "Only specific properties" lists the properties to watch. */
  const createChoices = (): Parameters<typeof openMenu>[1] => [false, true].map((on) => ({
    type: PopoverItemType.Default as const,
    name: `database-autofill-trigger-onCreate-${on ? 'on' : 'off'}`,
    title: i18n.t(on ? 'tools.database.aiAutofillTriggerAnyCreation' : 'tools.database.aiAutofillTriggerNone'),
    isActive: state.draft.onCreate === on,
    closeOnActivate: true,
    onActivate: () => update({ onCreate: on }),
  }));
  const watched = (id: string): boolean => state.draft.onEditProperties?.includes(id) === true;
  const toggleWatched = (id: string): void => {
    const next = watched(id) ? (state.draft.onEditProperties ?? []).filter((other) => other !== id) : [...(state.draft.onEditProperties ?? []), id];

    // No property left to watch means no trigger.
    update(next.length === 0 ? { onEdit: false, onEditProperties: undefined } : { onEdit: true, onEditProperties: next });
  };
  const contentSwitch = (): HTMLElement => panelSwitch({
    label: i18n.t('tools.database.aiAutofillTriggerContent'),
    testId: 'database-autofill-trigger-content',
    checked: state.draft.onEditContent,
    onToggle: (next) => update({ onEditContent: next }),
  });
  const propertyHeading = (): HTMLElement => {
    const heading = panelLabel(i18n.t('tools.database.aiAutofillTriggerPropertyHeading'));

    heading.setAttribute('role', 'presentation');

    return heading;
  };
  /** Notion: the page content switch, then "When a property is updated" and its choices. */
  const updateChoices = (): Parameters<typeof openMenu>[1] => [
    { type: PopoverItemType.Html, element: contentSwitch(), name: 'database-autofill-trigger-content' },
    { type: PopoverItemType.Separator },
    { type: PopoverItemType.Html, element: propertyHeading(), name: 'database-autofill-trigger-heading' },
    {
      type: PopoverItemType.Default,
      name: 'database-autofill-trigger-onEdit-off',
      title: i18n.t('tools.database.aiAutofillTriggerNone'),
      isActive: !state.draft.onEdit,
      closeOnActivate: true,
      onActivate: () => update({ onEdit: false, onEditProperties: undefined }),
    },
    {
      type: PopoverItemType.Default,
      name: 'database-autofill-trigger-onEdit-any',
      title: i18n.t('tools.database.aiAutofillTriggerAnyProperty'),
      isActive: state.draft.onEdit && state.draft.onEditProperties === undefined,
      closeOnActivate: true,
      onActivate: () => update({ onEdit: true, onEditProperties: undefined }),
    },
    {
      type: PopoverItemType.Default,
      name: 'database-autofill-trigger-onEdit-specific',
      title: i18n.t('tools.database.aiAutofillTriggerSpecific'),
      isActive: state.draft.onEdit && state.draft.onEditProperties !== undefined,
      children: {
        items: options.triggerProperties().map((property) => ({
          type: PopoverItemType.Default as const,
          name: `database-autofill-trigger-property-${property.id}`,
          title: property.name,
          isActive: () => watched(property.id),
          onActivate: () => toggleWatched(property.id),
        })),
      },
    },
  ];
  const triggerValue = (key: 'onCreate' | 'onEdit'): string => {
    if (key === 'onCreate') return i18n.t(state.draft.onCreate ? 'tools.database.aiAutofillTriggerAnyCreation' : 'tools.database.aiAutofillTriggerNone');
    const parts = [
      ...(state.draft.onEditContent ? [i18n.t('tools.database.aiAutofillTriggerContentValue')] : []),
      ...(state.draft.onEdit ? [i18n.t(state.draft.onEditProperties === undefined ? 'tools.database.aiAutofillTriggerAnyProperty' : 'tools.database.aiAutofillTriggerSpecific')] : []),
    ];

    return parts.length === 0 ? i18n.t('tools.database.aiAutofillTriggerNone') : listOf(parts, i18n.getLocale());
  };
  const trigger = (labelKey: string, key: 'onCreate' | 'onEdit'): HTMLButtonElement => {
    const label = i18n.t(labelKey);
    const row = panelRow({
      label,
      value: '',
      testId: `database-autofill-${key}`,
      onClick: () => menu(row, key === 'onCreate' ? createChoices() : updateChoices()),
    });

    row.setAttribute('data-trigger-label', label);

    return row;
  };
  const onCreate = trigger('tools.database.aiAutofillOnCreate', 'onCreate');
  const onEdit = trigger('tools.database.aiAutofillOnUpdate', 'onEdit');

  more.addEventListener('click', () => menu(more, [{
    type: PopoverItemType.Default,
    name: 'database-autofill-delete',
    title: i18n.t('tools.database.aiAutofillDelete'),
    icon: IconTrash,
    isDestructive: true,
    closeOnActivate: true,
    onActivate: () => {
      if (!options.writable()) return;
      options.onDelete();
      options.onDraft(undefined);
      finish();
    },
  }]));

  const confirm = { abort: null as AbortController | null };
  const discard = button(footer, i18n.t('tools.database.aiAutofillDiscard'), () => {
    confirm.abort = new AbortController();
    void openDatabaseConfirm({
      title: i18n.t('tools.database.aiAutofillDiscardTitle'),
      confirmLabel: i18n.t('tools.database.aiAutofillDiscard'),
      cancelLabel: i18n.t('tools.database.aiAutofillDiscardCancel'),
      destructive: true,
      role: 'dialog',
      container: panel,
      directionSource: options.directionSource ?? null,
      signal: confirm.abort.signal,
    }).then((confirmed) => {
      if (!confirmed || state.closed) return;
      // Replace, not merge: a key the saved settings lack (Translate's language) must go too.
      state.draft = saved();
      field.value = state.draft.instruction;
      sync();
      // Discard is disabled now: focus on it would fall out of the trap.
      field.focus();
    });
  });
  const generate = button(footer, i18n.t('tools.database.aiAutofillGenerate'), () => {
    if (options.writable()) options.onGenerate(settingsOf(state.draft));
  });
  const runNow = button(footer, i18n.t('tools.database.aiAutofillRunNow'), () => {
    if (options.writable()) options.onRunNow();
  });
  const save = button(footer, i18n.t('tools.database.aiAutofillSave'), () => {
    if (!options.writable()) return;
    options.onSave(settingsOf(state.draft));
    sync();
  });

  save.setAttribute('data-primary', '');

  function sync(): void {
    const filled = runnable(state.draft);
    const changed = !sameDraft(state.draft, saved());
    const writable = options.writable();
    const stored = runnable(saved());

    options.onDraft(changed ? state.draft : undefined);
    ([[onCreate, 'onCreate'], [onEdit, 'onEdit']] as const).forEach(([el, key]) => {
      const value = triggerValue(key);
      const valueEl = el.querySelector('[data-blok-database-panel-value]');

      if (valueEl !== null) valueEl.textContent = value;
      el.setAttribute('aria-label', `${el.getAttribute('data-trigger-label') ?? ''} ${value}`);
    });
    more.disabled = !options.writable() || options.property()?.autofill === undefined;
    discard.disabled = !changed;
    save.disabled = !writable || !filled || !changed;
    generate.disabled = !writable || !filled;
    runNow.disabled = !writable || !stored || changed || !options.hasRows();
  }

  // An edited preset is the user's own instruction: the preset mode and language no longer describe it.
  field.addEventListener('input', () => update({ mode: 'custom', language: undefined, instruction: field.value }));
  close.addEventListener('click', () => finish());

  panel.append(
    header,
    tabs,
    panelLabel(i18n.t('tools.database.aiAutofillInstructions')),
    field,
    presets,
    onCreate,
    onEdit,
    footer
  );
  backdrop.appendChild(panel);
  sync();

  const handle = openModalDialog({
    content: backdrop,
    surface: panel,
    role: 'dialog',
    labelledBy: title.id,
    initialFocus: () => field,
    directionSource: options.directionSource ?? null,
    // The preset and trigger menus are not dismiss layers: a press on them is not "outside".
    outside: false,
    onDismiss: () => finish(),
  });

  function finish(): void {
    if (state.closed) return;
    state.closed = true;
    // Before the setup goes: the confirm restores focus and inert while the panel is still attached.
    confirm.abort?.abort();
    handle.close();
    options.onClose();
  }

  return { close: finish };
};
