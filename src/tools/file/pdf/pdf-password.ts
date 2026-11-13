import type { PreviewLabels } from '../preview-labels';

/** pdf.js `PasswordResponses.INCORRECT_PASSWORD`. */
const WRONG_PASSWORD = 2;

/**
 * Fills `body` with a password prompt. `answer` gets the password, or an
 * Error when the user gives up, which makes pdf.js fail the load.
 */
export function askPdfPassword(
  body: HTMLElement,
  labels: PreviewLabels,
  reason: number,
  answer: (password: string | Error) => void,
): void {
  const form = document.createElement('form');
  form.className = 'blok-file-preview-pdf-password';
  form.setAttribute('data-role', 'file-preview-pdf-password');

  const prompt = document.createElement('p');
  prompt.className = 'blok-file-preview-error__title';
  prompt.textContent = labels.pdfPassword;
  form.appendChild(prompt);

  if (reason === WRONG_PASSWORD) {
    const wrong = document.createElement('p');
    wrong.className = 'blok-file-preview-error__detail';
    wrong.setAttribute('data-role', 'file-preview-pdf-password-wrong');
    wrong.setAttribute('role', 'alert');
    wrong.textContent = labels.pdfPasswordWrong;
    form.appendChild(wrong);
  }

  const input = document.createElement('input');
  input.type = 'password';
  input.autocomplete = 'off';
  input.setAttribute('data-blok-field', '');
  input.setAttribute('aria-label', labels.pdfPassword);
  if (reason === WRONG_PASSWORD) {
    input.setAttribute('aria-invalid', 'true');
  }

  const actions = document.createElement('div');
  actions.className = 'blok-file-preview-pdf-password-actions';
  const button = (label: string, action: string, type: 'button' | 'submit'): HTMLButtonElement => {
    const node = document.createElement('button');
    node.type = type;
    node.className = 'blok-file-preview-bar-button';
    node.setAttribute('data-action', action);
    node.textContent = label;
    actions.appendChild(node);

    return node;
  };
  button(labels.cancel, 'preview-pdf-password-cancel', 'button')
    .addEventListener('click', () => answer(new Error('No password given')));
  button(labels.pdfOpen, 'preview-pdf-password-open', 'submit');

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    answer(input.value);
  });
  form.append(input, actions);

  const card = document.createElement('div');
  card.className = 'blok-file-preview-error';
  card.appendChild(form);
  body.replaceChildren(card);
  input.focus();
}
