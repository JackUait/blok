import { button, el, field } from '../ui/dom';

export interface UnreachableOptions {
  frame(): HTMLElement;
  run(action: () => Promise<void>): Promise<void>;
  showError(reason: unknown): void;
  /** Current server origin for the address field. */
  currentOrigin: string;
  /** Retry the gateway boot sequence. */
  onRetry(): void | Promise<void>;
  /** Optional: switch to another server (same validation as login). */
  onServerChange?(origin: string): void | Promise<void>;
}

/** Dedicated screen when the instance cannot be reached (plan §9.1 `unreachable`). */
export function mountUnreachable(options: UnreachableOptions): void {
  const main = options.frame();
  main.setAttribute('data-cloud-narrow', '');
  main.append(
    el('span', { text: 'Connexion', attribute: 'data-cloud-eyebrow' }),
    el('h1', { text: 'Serveur injoignable' }),
    el('p', {
      text: 'Vérifiez l’adresse du serveur et votre connexion, puis réessayez.',
      attribute: 'data-cloud-muted',
    }),
  );
  main.append(button({
    label: 'Réessayer',
    primary: true,
    onClick: () => { void options.run(async () => { await options.onRetry(); }); },
  }));

  if (!options.onServerChange) return;
  const details = el('details', { attribute: 'data-cloud-section' });
  details.append(el('summary', { text: 'Se connecter à un autre serveur' }));
  const form = el('form');
  const server = field({
    form,
    label: 'Adresse du serveur',
    type: 'url',
    name: 'server',
    value: options.currentOrigin,
  });
  server.placeholder = 'https://votre-serveur.fr';
  server.setAttribute('autocomplete', 'url');
  server.spellcheck = false;
  const submit = button({ label: 'Utiliser ce serveur', primary: true, type: 'submit', onClick: () => {} });
  form.append(submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void options.run(async () => {
      let url: URL;
      try {
        url = new URL(server.value.trim());
      } catch {
        throw new Error('Saisissez l’adresse complète du serveur, par exemple https://votre-serveur.fr.');
      }
      if (
        url.username
        || url.password
        || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      ) {
        throw new Error('Utilisez une adresse HTTPS sans identifiants.');
      }
      await options.onServerChange!(url.origin);
    });
  });
  details.append(
    el('p', { text: 'Chaque serveur conserve ses propres comptes et espaces.', attribute: 'data-cloud-note' }),
    form,
  );
  main.append(details);
}
