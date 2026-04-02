import type { OutputData } from '../../../types';
import type { ToolsConfig } from '../../../types/api/tools';
import type { KanbanCardData, KanbanColumnData } from './types';
import { IconChevronRight } from '../../components/icons';

interface BlokInstance {
  save(): Promise<OutputData>;
  destroy(): void;
  isReady: Promise<void>;
}

export interface CardDrawerOptions {
  wrapper: HTMLElement;
  readOnly: boolean;
  toolsConfig?: ToolsConfig;
  onTitleChange: (cardId: string, title: string) => void;
  onDescriptionChange: (cardId: string, description: OutputData) => void;
  onClose: () => void;
}

/**
 * Side drawer that opens when a kanban card is clicked.
 * Sits beside the board as a flex sibling, taking layout space.
 * Contains a title input, status property, and a nested Blok editor for the card description.
 */
export class DatabaseCardDrawer {
  private readonly wrapper: HTMLElement;
  private readonly readOnly: boolean;
  private readonly toolsConfig: ToolsConfig | undefined;
  private readonly onTitleChange: (cardId: string, title: string) => void;
  private readonly onDescriptionChange: (cardId: string, description: OutputData) => void;
  private readonly onClose: () => void;

  private drawer: HTMLDivElement | null = null;
  private currentCardId: string | null = null;
  private blokInstance: BlokInstance | null = null;
  private escapeHandler: ((e: KeyboardEvent) => void) | null = null;
  private outsideClickHandler: ((e: MouseEvent) => void) | null = null;

  constructor(options: CardDrawerOptions) {
    this.wrapper = options.wrapper;
    this.readOnly = options.readOnly;
    this.toolsConfig = options.toolsConfig;
    this.onTitleChange = options.onTitleChange;
    this.onDescriptionChange = options.onDescriptionChange;
    this.onClose = options.onClose;
  }

  get isOpen(): boolean {
    return this.drawer !== null;
  }

  open(card: KanbanCardData, column?: KanbanColumnData): void {
    if (this.drawer) {
      if (card.id === this.currentCardId) {
        return;
      }

      this.loadCard(card, column);

      return;
    }

    // Remove any drawer still animating out from a previous close
    const exiting = this.wrapper.querySelector('[data-blok-database-drawer]');

    exiting?.remove();

    this.currentCardId = card.id;
    this.updateActiveCard(card.id);

    const drawer = document.createElement('div');

    drawer.setAttribute('data-blok-database-drawer', '');
    drawer.setAttribute('role', 'complementary');
    drawer.setAttribute('aria-label', 'Card details');

    // --- Top toolbar ---
    const toolbar = document.createElement('div');

    toolbar.setAttribute('data-blok-database-drawer-toolbar', '');

    const closeBtn = document.createElement('button');

    closeBtn.setAttribute('data-blok-database-drawer-close', '');
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = IconChevronRight + IconChevronRight;
    closeBtn.addEventListener('click', () => {
      this.close();
    });
    toolbar.appendChild(closeBtn);

    drawer.appendChild(toolbar);

    // --- Scrollable content ---
    const content = document.createElement('div');

    content.setAttribute('data-blok-database-drawer-content', '');

    // --- Title input ---
    const titleInput = document.createElement('textarea');

    titleInput.setAttribute('data-blok-database-drawer-title', '');
    titleInput.setAttribute('aria-label', 'Card title');
    titleInput.placeholder = 'Untitled';
    titleInput.value = card.title;
    titleInput.rows = 1;
    titleInput.readOnly = this.readOnly;
    titleInput.addEventListener('input', () => {
      if (this.currentCardId !== null) {
        this.onTitleChange(this.currentCardId, titleInput.value);
      }
      this.autoResizeTitle(titleInput);
    });
    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
      }
    });
    content.appendChild(titleInput);

    // --- Properties section ---
    if (column !== undefined) {
      const propsSection = document.createElement('div');

      propsSection.setAttribute('data-blok-database-drawer-props', '');

      const statusRow = this.createPropertyRow(column);

      propsSection.appendChild(statusRow);
      content.appendChild(propsSection);
    }

    // --- Divider ---
    const divider = document.createElement('hr');

    content.appendChild(divider);

    // --- Editor holder ---
    const editorHolder = document.createElement('div');

    editorHolder.setAttribute('data-blok-database-drawer-editor', '');
    content.appendChild(editorHolder);

    drawer.appendChild(content);
    this.wrapper.appendChild(drawer);
    this.drawer = drawer;

    requestAnimationFrame(() => {
      drawer.style.width = '45%';
      drawer.addEventListener('transitionend', () => {
        this.autoResizeTitle(titleInput);
      }, { once: true });
    });

    this.initNestedEditor(editorHolder, card);

    this.escapeHandler = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') {
        return;
      }

      const target = e.target as Node | null;

      if (target && editorHolder.contains(target)) {
        return;
      }

      this.close();
    };
    document.addEventListener('keydown', this.escapeHandler);

    this.outsideClickHandler = (e: MouseEvent): void => {
      const target = e.target as Node | null;

      if (target && drawer.contains(target)) {
        return;
      }

      this.close();
    };
    document.addEventListener('mousedown', this.outsideClickHandler);

    titleInput.focus();
  }

  /**
   * Swaps content in the already-open drawer to show a different card
   * without closing/reopening the drawer panel.
   */
  private loadCard(card: KanbanCardData, column?: KanbanColumnData): void {
    if (this.drawer === null) {
      return;
    }

    this.cleanupEditor();

    this.currentCardId = card.id;
    this.updateActiveCard(card.id);

    // Update title
    const titleInput = this.drawer.querySelector<HTMLTextAreaElement>('[data-blok-database-drawer-title]');

    if (titleInput !== null) {
      titleInput.value = card.title;
      this.autoResizeTitle(titleInput);
    }

    // Replace properties section
    this.drawer.querySelector('[data-blok-database-drawer-props]')?.remove();

    if (column !== undefined) {
      const content = this.drawer.querySelector('[data-blok-database-drawer-content]');
      const divider = content?.querySelector('hr') ?? null;

      if (content !== null) {
        const propsSection = document.createElement('div');

        propsSection.setAttribute('data-blok-database-drawer-props', '');
        propsSection.appendChild(this.createPropertyRow(column));
        content.insertBefore(propsSection, divider);
      }
    }

    // Reinitialize editor
    const editorHolder = this.drawer.querySelector<HTMLElement>('[data-blok-database-drawer-editor]');

    if (editorHolder !== null) {
      editorHolder.innerHTML = '';
      this.initNestedEditor(editorHolder, card);
    }
  }

  close(): void {
    const wasOpen = this.drawer !== null;

    this.updateActiveCard(null);
    this.cleanupListeners();
    this.cleanupEditor();

    if (this.drawer) {
      const drawer = this.drawer;

      this.drawer = null;
      drawer.style.width = '0px';
      drawer.addEventListener('transitionend', () => {
        drawer.remove();
      }, { once: true });
    }

    this.currentCardId = null;

    if (wasOpen) {
      this.onClose();
    }
  }

  destroy(): void {
    this.cleanupListeners();
    this.cleanupEditor();

    if (this.drawer) {
      this.drawer.remove();
      this.drawer = null;
    }

    // Remove any drawer still animating out
    const exiting = this.wrapper.querySelector('[data-blok-database-drawer]');

    exiting?.remove();

    this.currentCardId = null;
  }

  /**
   * Creates a status property row with icon, label, and column pill badge.
   */
  private createPropertyRow(column: KanbanColumnData): HTMLDivElement {
    const row = document.createElement('div');

    row.setAttribute('data-blok-database-drawer-prop-row', '');

    const label = document.createElement('span');

    label.setAttribute('data-blok-database-drawer-prop-label', '');
    label.textContent = 'Status';
    row.appendChild(label);

    const pill = document.createElement('span');

    pill.setAttribute('data-blok-database-drawer-status-pill', '');

    if (column.color !== undefined) {
      pill.style.backgroundColor = `var(--blok-color-${column.color}-bg)`;
      pill.style.color = `var(--blok-color-${column.color}-text)`;
    }

    if (column.color !== undefined) {
      const dot = document.createElement('span');

      dot.setAttribute('data-blok-database-drawer-status-dot', '');
      dot.style.backgroundColor = `var(--blok-color-${column.color}-text)`;
      pill.appendChild(dot);
    }

    const pillText = document.createElement('span');

    pillText.textContent = column.title;
    pill.appendChild(pillText);

    row.appendChild(pill);

    return row;
  }

  private updateActiveCard(cardId: string | null): void {
    const prev = this.wrapper.querySelector('[data-blok-database-card-active]');

    prev?.removeAttribute('data-blok-database-card-active');

    if (cardId !== null) {
      const cardEl = this.wrapper.querySelector(`[data-blok-database-card][data-card-id="${cardId}"]`);

      cardEl?.setAttribute('data-blok-database-card-active', '');
    }
  }

  private cleanupListeners(): void {
    if (this.escapeHandler) {
      document.removeEventListener('keydown', this.escapeHandler);
      this.escapeHandler = null;
    }

    if (this.outsideClickHandler) {
      document.removeEventListener('mousedown', this.outsideClickHandler);
      this.outsideClickHandler = null;
    }
  }

  private cleanupEditor(): void {
    if (this.blokInstance) {
      try {
        const instance = this.blokInstance;
        const cardId = this.currentCardId;

        instance.save().then((data) => {
          if (cardId !== null) {
            this.onDescriptionChange(cardId, data);
          }
          instance.destroy();
        }).catch(() => {
          instance.destroy();
        });
      } catch {
        // Blok may already be destroyed
      }
      this.blokInstance = null;
    }
  }

  private autoResizeTitle(textarea: HTMLTextAreaElement): void {
    textarea.style.height = 'auto';

    if (textarea.scrollHeight > 0) {
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }

  private initNestedEditor(editorHolder: HTMLElement, card: KanbanCardData): void {
    import('../../blok').then(({ Blok }) => {
      const cardId = card.id;
      const blok = new Blok({
        ...this.toolsConfig,
        holder: editorHolder,
        data: card.description,
        readOnly: this.readOnly,
        onChange: async () => {
          try {
            const data = await this.blokInstance?.save();

            if (data !== undefined) {
              this.onDescriptionChange(cardId, data);
            }
          } catch {
            // save may fail if editor is being destroyed
          }
        },
      });

      this.blokInstance = blok as unknown as BlokInstance;
    }).catch(() => {
      // Blok import may fail in unit tests (jsdom), drawer still works for title
    });
  }
}
