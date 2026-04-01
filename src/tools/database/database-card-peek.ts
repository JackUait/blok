import type { OutputData } from '../../../types';
import type { KanbanCardData } from './types';

interface BlokInstance {
  save(): Promise<OutputData>;
  destroy(): void;
  isReady: Promise<void>;
}

export interface CardPeekOptions {
  wrapper: HTMLElement;
  readOnly: boolean;
  onTitleChange: (cardId: string, title: string) => void;
  onDescriptionChange: (cardId: string, description: OutputData) => void;
  onClose: () => void;
}

/**
 * Side panel that opens when a kanban card is clicked.
 * Contains a title input and a nested Blok editor for the card description.
 */
export class DatabaseCardPeek {
  private readonly wrapper: HTMLElement;
  private readonly readOnly: boolean;
  private readonly onTitleChange: (cardId: string, title: string) => void;
  private readonly onDescriptionChange: (cardId: string, description: OutputData) => void;
  private readonly onClose: () => void;

  private panel: HTMLDivElement | null = null;
  private currentCardId: string | null = null;
  private blokInstance: BlokInstance | null = null;
  private escapeHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(options: CardPeekOptions) {
    this.wrapper = options.wrapper;
    this.readOnly = options.readOnly;
    this.onTitleChange = options.onTitleChange;
    this.onDescriptionChange = options.onDescriptionChange;
    this.onClose = options.onClose;
  }

  get isOpen(): boolean {
    return this.panel !== null;
  }

  open(card: KanbanCardData): void {
    if (this.panel) {
      this.close();
    }

    this.currentCardId = card.id;

    const panel = document.createElement('div');

    panel.setAttribute('data-blok-database-peek', '');
    panel.setAttribute('role', 'complementary');
    panel.setAttribute('aria-label', 'Card details');
    panel.style.position = 'absolute';
    panel.style.right = '0';
    panel.style.top = '0';
    panel.style.bottom = '0';
    panel.style.width = '400px';
    panel.style.zIndex = '10';
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    panel.style.borderLeft = '1px solid var(--blok-popover-border, #e8e8eb)';
    panel.style.backgroundColor = 'var(--blok-popover-bg, #fff)';
    panel.style.boxShadow = '-4px 0 12px rgba(0, 0, 0, 0.08)';
    panel.style.transform = 'translateX(100%)';

    const closeBtn = document.createElement('button');

    closeBtn.setAttribute('data-blok-database-peek-close', '');
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
    panel.appendChild(closeBtn);

    const titleInput = document.createElement('input');

    titleInput.setAttribute('data-blok-database-peek-title', '');
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
    panel.appendChild(titleInput);

    const divider = document.createElement('hr');

    panel.appendChild(divider);

    const editorHolder = document.createElement('div');

    editorHolder.setAttribute('data-blok-database-peek-editor', '');
    editorHolder.style.flex = '1';
    editorHolder.style.overflow = 'auto';
    editorHolder.style.padding = '0 8px';
    panel.appendChild(editorHolder);

    this.wrapper.style.position = 'relative';
    this.wrapper.appendChild(panel);
    this.panel = panel;

    requestAnimationFrame(() => {
      panel.style.transform = 'translateX(0)';
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
    const wasOpen = this.panel !== null;

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

    if (this.panel) {
      this.panel.remove();
      this.panel = null;
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
      // Blok import may fail in unit tests (jsdom), panel still works for title
    });
  }
}
