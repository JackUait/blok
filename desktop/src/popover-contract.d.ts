/** Type boundary for the repository's real desktop popover implementation. */
import type { PopoverParams } from '../../types/utils/popover/popover';
export class PopoverDesktop {
  constructor(options: PopoverParams);
  readonly isShown: boolean;
  getElement(): HTMLElement;
  getMountElement(): HTMLElement;
  show(): void;
  hide(): void;
  destroy(): void;
  focusItemByName(name: string): boolean;
  on(event: 'closed' | 'closed-on-activate', listener: () => void): void;
}
