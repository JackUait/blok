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
    panel.style.position = 'absolute';
    panel.style.right = '0';
    panel.style.top = '0';
    panel.style.bottom = '0';
    panel.style.width = '400px';
    panel.style.zIndex = '10';
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';

    const closeBtn = document.createElement('button');

    closeBtn.setAttribute('data-blok-database-peek-close', '');
    closeBtn.style.position = 'absolute';
    closeBtn.style.top = '0';
    closeBtn.style.right = '0';
    closeBtn.addEventListener('click', () => {
      this.onClose();
      this.close();
    });
    panel.appendChild(closeBtn);

    const titleInput = document.createElement('input');

    titleInput.setAttribute('data-blok-database-peek-title', '');
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
    panel.appendChild(editorHolder);

    this.wrapper.style.position = 'relative';
    this.wrapper.appendChild(panel);
    this.panel = panel;

    this.initNestedEditor(editorHolder, card);

    this.escapeHandler = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') {
        return;
      }

      const target = e.target as Node | null;

      if (target && editorHolder.contains(target)) {
        return;
      }

      this.onClose();
      this.close();
    };
    document.addEventListener('keydown', this.escapeHandler);

    titleInput.focus();
  }

  close(): void {
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
