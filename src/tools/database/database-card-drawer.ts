import type { OutputData } from '../../../types';
import type { KanbanCardData } from './types';

interface BlokInstance {
  save(): Promise<OutputData>;
  destroy(): void;
  isReady: Promise<void>;
}

export interface CardDrawerOptions {
  wrapper: HTMLElement;
  readOnly: boolean;
  onTitleChange: (cardId: string, title: string) => void;
  onDescriptionChange: (cardId: string, description: OutputData) => void;
  onClose: () => void;
}

/**
 * Side drawer that opens when a kanban card is clicked.
 * Sits beside the board as a flex sibling, taking layout space.
 * Contains a title input and a nested Blok editor for the card description.
 */
export class DatabaseCardDrawer {
  private readonly wrapper: HTMLElement;
  private readonly readOnly: boolean;
  private readonly onTitleChange: (cardId: string, title: string) => void;
  private readonly onDescriptionChange: (cardId: string, description: OutputData) => void;
  private readonly onClose: () => void;

  private drawer: HTMLDivElement | null = null;
  private currentCardId: string | null = null;
  private blokInstance: BlokInstance | null = null;
  private escapeHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(options: CardDrawerOptions) {
    this.wrapper = options.wrapper;
    this.readOnly = options.readOnly;
    this.onTitleChange = options.onTitleChange;
    this.onDescriptionChange = options.onDescriptionChange;
    this.onClose = options.onClose;
  }

  get isOpen(): boolean {
    return this.drawer !== null;
  }

  open(card: KanbanCardData): void {
    if (this.drawer) {
      this.close();
    }

    this.currentCardId = card.id;

    const drawer = document.createElement('div');

    drawer.setAttribute('data-blok-database-drawer', '');
    drawer.setAttribute('role', 'complementary');
    drawer.setAttribute('aria-label', 'Card details');
    drawer.style.flexShrink = '0';
    drawer.style.width = '0px';
    drawer.style.overflow = 'hidden';
    drawer.style.display = 'flex';
    drawer.style.flexDirection = 'column';
    drawer.style.borderLeft = '1px solid var(--blok-popover-border, #e8e8eb)';
    drawer.style.backgroundColor = 'var(--blok-popover-bg, #fff)';
    drawer.style.boxShadow = '-4px 0 12px rgba(0, 0, 0, 0.08)';

    const closeBtn = document.createElement('button');

    closeBtn.setAttribute('data-blok-database-drawer-close', '');
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.style.position = 'absolute';
    closeBtn.style.top = '0';
    closeBtn.style.right = '0';
    closeBtn.style.background = 'none';
    closeBtn.style.borderStyle = 'none';
    closeBtn.style.cursor = 'pointer';
    closeBtn.textContent = '\u00d7';
    closeBtn.addEventListener('click', () => {
      this.close();
    });
    drawer.appendChild(closeBtn);

    const titleInput = document.createElement('input');

    titleInput.setAttribute('data-blok-database-drawer-title', '');
    titleInput.setAttribute('aria-label', 'Card title');
    titleInput.style.fontSize = '20px';
    titleInput.style.padding = '16px 20px 8px';
    titleInput.style.border = 'none';
    titleInput.style.outline = 'none';
    titleInput.style.width = '100%';
    titleInput.style.fontWeight = '600';
    titleInput.style.backgroundColor = 'transparent';
    titleInput.value = card.title;
    titleInput.readOnly = this.readOnly;
    titleInput.addEventListener('input', () => {
      if (this.currentCardId !== null) {
        this.onTitleChange(this.currentCardId, titleInput.value);
      }
    });
    drawer.appendChild(titleInput);

    const divider = document.createElement('hr');

    drawer.appendChild(divider);

    const editorHolder = document.createElement('div');

    editorHolder.setAttribute('data-blok-database-drawer-editor', '');
    editorHolder.style.flex = '1';
    editorHolder.style.overflow = 'auto';
    editorHolder.style.padding = '0 8px';
    drawer.appendChild(editorHolder);

    this.wrapper.appendChild(drawer);
    this.drawer = drawer;

    requestAnimationFrame(() => {
      drawer.style.width = '400px';
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

    titleInput.focus();
  }

  close(): void {
    const wasOpen = this.drawer !== null;

    if (this.escapeHandler) {
      document.removeEventListener('keydown', this.escapeHandler);
      this.escapeHandler = null;
    }

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

    if (this.drawer) {
      this.drawer.remove();
      this.drawer = null;
    }

    this.currentCardId = null;

    if (wasOpen) {
      this.onClose();
    }
  }

  destroy(): void {
    this.close();
  }

  private initNestedEditor(editorHolder: HTMLElement, card: KanbanCardData): void {
    import('../../blok').then(({ Blok }) => {
      const cardId = card.id;
      const blok = new Blok({
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
