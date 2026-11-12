/** Desktop type boundary for the repository's shared modal-dialog primitive. */
export type ModalDismissReason = 'escape' | 'outside';
export interface OpenModalDialogOptions {
  content: HTMLElement;
  surface?: HTMLElement;
  role?: 'dialog' | 'alertdialog';
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  initialFocus?: () => HTMLElement | null;
  onDismiss: (reason: ModalDismissReason) => void;
  onClose?: () => void;
  container?: HTMLElement | null;
  topLayer?: boolean;
  anchor?: HTMLElement;
  directionSource?: Element | null;
  onDirectionResync?: () => void;
  escape?: boolean;
  outside?: boolean;
  animationTarget?: HTMLElement;
  interactiveRoot?: HTMLElement;
}
export interface ModalDialogHandle {
  readonly content: HTMLElement;
  readonly surface: HTMLElement;
  close(): void;
  closeAnimated(): void;
}
export function openModalDialog(options: OpenModalDialogOptions): ModalDialogHandle;
export function getTabbables(container: HTMLElement): HTMLElement[];
