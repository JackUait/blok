import { openModalDialog, type ModalDialogHandle } from '../../../components/utils/modal-dialog';
import { beautifyShortcut } from '../../../components/utils/string';
import type { I18nInstance } from '../../../components/utils/tools';
import { tr } from '../i18n';

export type ShortcutGroup = 'general' | 'crop' | 'markup';

export interface ShortcutRow {
  group: ShortcutGroup;
  /** i18n key of what the keys do. */
  label: string;
  /** Alternatives. CMD and SHIFT go through beautifyShortcut; anything else shows as written. */
  keys: string[];
  /** Only offered when the darkroom shows a Filters tab. */
  filters?: boolean;
}

/** Every darkroom key, so the sheet is the one list of them. index.ts and markup-editor.ts handle them. */
export const SHORTCUTS: readonly ShortcutRow[] = [
  { group: 'general', label: 'tools.image.cropDone', keys: ['⏎'] },
  { group: 'general', label: 'tools.image.cropCancel', keys: ['Esc'] },
  { group: 'general', label: 'tools.image.shortcutUndo', keys: ['CMD+Z'] },
  { group: 'general', label: 'tools.image.shortcutRedo', keys: ['CMD+SHIFT+Z'] },
  { group: 'general', label: 'tools.image.editModeCrop', keys: ['C', 'R'] },
  { group: 'general', label: 'tools.image.editModeAdjust', keys: ['A'] },
  { group: 'general', label: 'tools.image.editModeFilters', keys: ['F'], filters: true },
  { group: 'general', label: 'tools.image.shortcutShowOriginal', keys: ['M'] },
  { group: 'general', label: 'tools.image.shortcutZoomActual', keys: ['Z'] },
  { group: 'general', label: 'tools.image.zoomIn', keys: ['CMD+='] },
  { group: 'general', label: 'tools.image.zoomOut', keys: ['CMD+-'] },
  { group: 'general', label: 'tools.image.shortcutZoomFit', keys: ['CMD+0'] },
  { group: 'general', label: 'tools.image.shortcutPan', keys: ['Space'] },
  { group: 'general', label: 'tools.image.rotateLeft', keys: ['CMD+['] },
  { group: 'general', label: 'tools.image.rotateRight', keys: ['CMD+]'] },
  { group: 'general', label: 'tools.image.flip', keys: ['SHIFT+H'] },
  { group: 'general', label: 'tools.image.shortcutsTitle', keys: ['?'] },
  { group: 'crop', label: 'tools.image.shortcutSwapOrientation', keys: ['X'] },
  { group: 'crop', label: 'tools.image.shortcutMoveCrop', keys: ['← ↑ → ↓'] },
  { group: 'crop', label: 'tools.image.shortcutStraightenSnap', keys: ['SHIFT'] },
  { group: 'markup', label: 'tools.image.markupSelect', keys: ['V'] },
  { group: 'markup', label: 'tools.image.markupPen', keys: ['P', 'B'] },
  { group: 'markup', label: 'tools.image.markupHighlighter', keys: ['H'] },
  { group: 'markup', label: 'tools.image.markupEraser', keys: ['E'] },
  { group: 'markup', label: 'tools.image.markupText', keys: ['T'] },
  { group: 'markup', label: 'tools.image.markupRectangle', keys: ['R'] },
  { group: 'markup', label: 'tools.image.markupEllipse', keys: ['O'] },
  { group: 'markup', label: 'tools.image.markupArrow', keys: ['A'] },
  { group: 'markup', label: 'tools.image.markupLine', keys: ['L'] },
  { group: 'markup', label: 'tools.image.markupShapes', keys: ['U'] },
  { group: 'markup', label: 'tools.image.markupSizes', keys: ['[', ']'] },
  { group: 'markup', label: 'blockSettings.duplicate', keys: ['CMD+D'] },
  { group: 'markup', label: 'blockSettings.delete', keys: ['⌫'] },
];

const HEADINGS: Record<ShortcutGroup, string> = {
  general: 'tools.image.shortcutsGeneral',
  crop: 'tools.image.editModeCrop',
  markup: 'tools.image.editModeMarkup',
};

// beautifyShortcut also rewrites words like "left", so only chords with a modifier go through it.
const show = (key: string): string => (/CMD|SHIFT/.test(key) ? beautifyShortcut(key) : key);

export interface ShortcutSheetOptions {
  i18n?: I18nInstance;
  /** The darkroom surface; the sheet mounts inside it. */
  container: HTMLElement;
  showFilters: boolean;
  onClose(): void;
}

export function openShortcutSheet(o: ShortcutSheetOptions): ModalDialogHandle {
  const sheet = document.createElement('div');

  sheet.className = 'blok-darkroom__shortcuts';
  sheet.setAttribute('data-role', 'darkroom-shortcuts');
  sheet.tabIndex = -1;
  const title = document.createElement('h2');

  title.className = 'blok-darkroom__shortcuts-title';
  title.textContent = tr(o.i18n, 'tools.image.shortcutsTitle');
  sheet.appendChild(title);

  (Object.keys(HEADINGS) as ShortcutGroup[]).forEach((group) => {
    const section = document.createElement('section');
    const heading = document.createElement('h3');
    const list = document.createElement('dl');

    section.className = 'blok-darkroom__shortcuts-group';
    heading.textContent = tr(o.i18n, HEADINGS[group]);
    SHORTCUTS.filter((r) => r.group === group && (o.showFilters || r.filters !== true)).forEach((r) => {
      const row = document.createElement('div');
      const what = document.createElement('dt');
      const keys = document.createElement('dd');

      row.className = 'blok-darkroom__shortcuts-row';
      row.setAttribute('data-shortcut', r.label);
      what.textContent = tr(o.i18n, r.label);
      keys.append(...r.keys.map((k) => {
        const kbd = document.createElement('kbd');

        kbd.textContent = show(k);

        return kbd;
      }));
      row.append(what, keys);
      list.appendChild(row);
    });
    section.append(heading, list);
    sheet.appendChild(section);
  });

  const ref: { handle: ModalDialogHandle | null } = { handle: null };

  ref.handle = openModalDialog({
    content: sheet,
    container: o.container,
    label: tr(o.i18n, 'tools.image.shortcutsTitle'),
    initialFocus: () => sheet,
    onDismiss: () => ref.handle?.close(),
    onClose: o.onClose,
  });

  return ref.handle;
}
