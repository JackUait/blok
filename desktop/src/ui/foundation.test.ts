import { afterEach, describe, expect, it, vi } from 'vitest';
import { WORKSPACE_ROLES } from '../access-vocabulary';
import { avatarInitials, createAvatar } from './avatar';
import { createEmptyState } from './empty-state';
import { createFeedback } from './feedback';
import { button, el, field } from './dom';
import { createPeopleTable } from './people-table';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('ui/dom named options', () => {
  it('builds elements, buttons and fields from named options', () => {
    const clicked = vi.fn();
    const root = el('div', { attribute: 'data-demo', text: 'Hello', className: 'demo' });
    expect(root.getAttribute('data-demo')).toBe('');
    expect(root.textContent).toBe('Hello');
    expect(root.className).toBe('demo');
    const action = button({ label: 'Go', onClick: clicked, primary: true });
    expect(action.textContent).toBe('Go');
    expect(action.classList.contains('blok-button')).toBe(true);
    expect(action.hasAttribute('data-cloud-primary')).toBe(true);
    action.click();
    expect(clicked).toHaveBeenCalledOnce();
    const form = el('form');
    const input = field({ form, label: 'Adresse', type: 'email', name: 'email', value: 'a@b.test' });
    expect(form.querySelector('label')?.textContent).toBe('Adresse');
    expect(input.type).toBe('email');
    expect(input.value).toBe('a@b.test');
    expect(input.getAttribute('data-blok-field')).toBe('text');
  });
});

describe('ui/avatar', () => {
  it('derives initials from a name before falling back to email', () => {
    expect(avatarInitials({ email: 'alice@example.test', name: 'Alice Dupont' })).toBe('AD');
    expect(avatarInitials({ email: 'bob@example.test' })).toBe('B');
    const node = createAvatar({ email: 'carol@example.test', name: 'Carol' });
    expect(node.textContent).toBe('C');
    expect(node.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('ui/empty-state', () => {
  it('renders title and optional description', () => {
    const node = createEmptyState({ title: 'Aucun membre.', description: 'Invitez quelqu’un.' });
    expect(node.querySelector('strong')?.textContent).toBe('Aucun membre.');
    expect(node.querySelector('p')?.textContent).toBe('Invitez quelqu’un.');
  });
});

describe('ui/people-table', () => {
  it('renders identity rows with avatar initials', () => {
    const controls = el('div', { text: 'actions' });
    const table = createPeopleTable({
      actionHeader: 'Rôle',
      rows: [{ email: 'member@example.test', subtitle: WORKSPACE_ROLES.member, controls }],
    });
    expect(table.querySelector('th')?.textContent).toBe('Utilisateur');
    expect(table.textContent).toContain('member@example.test');
    expect(table.querySelector('[data-desktop-people-avatar]')?.textContent).toBe('M');
  });
});

describe('ui/feedback', () => {
  it('shows and clears a status message', () => {
    const feedback = createFeedback();
    document.body.append(feedback.element);
    expect(feedback.element.hidden).toBe(true);
    feedback.show('Lien copié');
    expect(feedback.element.hidden).toBe(false);
    expect(feedback.element.textContent).toBe('Lien copié');
    feedback.clear();
    expect(feedback.element.hidden).toBe(true);
    feedback.destroy();
  });
});
