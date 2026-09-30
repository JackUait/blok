import { openModalDialog } from './modal-dialog';
import { CSS } from './notifier/draw';
import { twJoin } from './tw';

export interface LeaveBannerLabels {
  title: string;
  retry: string;
  show: string;
  stay: string;
  leave: string;
}

export interface LeaveBannerHandlers {
  onRetry(): void;
  onShow(): void;
  onStay(): void;
  onLeave(): void;
}

export interface LeaveBanner {
  update(summary: string): void;
  close(): void;
}

const idState = { count: 0 };

/**
 * Shows the "leave anyway?" banner pinned to the top of the viewport.
 * @param summary - what is wrong, e.g. "Won't be saved: 2"
 * @param labels - localized texts
 * @param handlers - one per button; Escape runs `onStay`
 * @returns a handle to update the summary or close the banner
 */
export const openLeaveBanner = (summary: string, labels: LeaveBannerLabels, handlers: LeaveBannerHandlers): LeaveBanner => {
  const banner = document.createElement('div');
  const title = document.createElement('div');
  const text = document.createElement('div');
  const buttons = document.createElement('div');

  idState.count += 1;
  title.id = `blok-leave-banner-title-${idState.count}`;
  text.id = `blok-leave-banner-summary-${idState.count}`;

  banner.className = twJoin(CSS.notification, CSS.dialog, 'fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex-col items-start');
  banner.setAttribute('data-blok-testid', 'leave-banner');
  // Body-mounted: without a scope root, blok's utilities and reset do not apply.
  banner.setAttribute('data-blok-interface', 'leave-banner');

  title.className = 'font-medium';
  title.textContent = labels.title;
  text.setAttribute('data-blok-testid', 'leave-banner-summary');
  text.textContent = summary;
  buttons.className = CSS.btnsWrapper;

  const addButton = (label: string, id: string, primary: boolean, onClick: () => void): HTMLButtonElement => {
    const button = document.createElement('button');

    button.type = 'button';
    button.className = twJoin(CSS.btn, primary ? CSS.okBtn : CSS.cancelBtn);
    button.setAttribute('data-blok-testid', `leave-banner-${id}`);
    button.textContent = label;
    button.addEventListener('click', onClick);
    buttons.appendChild(button);

    return button;
  };

  const first = addButton(labels.retry, 'retry', true, () => handlers.onRetry());

  addButton(labels.show, 'show', false, () => handlers.onShow());
  addButton(labels.stay, 'stay', false, () => handlers.onStay());
  addButton(labels.leave, 'leave', false, () => handlers.onLeave());

  banner.append(title, text, buttons);
  // Mounted before the dialog opens so inert and focus apply synchronously.
  document.body.appendChild(banner);

  const dialog = openModalDialog({
    content: banner,
    role: 'alertdialog',
    labelledBy: title.id,
    describedBy: text.id,
    initialFocus: () => first,
    onDismiss: () => handlers.onStay(),
    container: null,
    // The top-layer reset (inset/padding/border) would undo the banner's own placement and chrome.
    topLayer: false,
    // Only a button or Escape answers the question.
    outside: false,
  });

  return {
    update: (next) => {
      text.textContent = next;
    },
    close: dialog.close,
  };
};
