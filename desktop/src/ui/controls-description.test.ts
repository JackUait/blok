import { afterEach, describe, expect, it, vi } from 'vitest';
import { WORKSPACE_ROLE_DESCRIPTIONS, WORKSPACE_ROLES } from '../access-vocabulary';
import { createChoice } from './controls';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('ChoiceOption description', () => {
  it('renders a second line when description is provided', async () => {
    const control = createChoice({
      label: 'Rôle',
      value: 'member',
      options: [
        { value: 'member', label: WORKSPACE_ROLES.member, description: WORKSPACE_ROLE_DESCRIPTIONS.member },
        { value: 'viewer', label: WORKSPACE_ROLES.viewer },
      ],
      onChange: () => {},
    });
    document.body.append(control.element);
    control.element.click();
    await vi.waitFor(() => expect(document.querySelector('[data-desktop-choice-popover]')).toBeTruthy());
    const described = document.querySelector('[data-blok-item-name=member] [data-blok-popover-item-description]');
    expect(described?.textContent).toBe(WORKSPACE_ROLE_DESCRIPTIONS.member);
    expect(document.querySelector('[data-blok-item-name=viewer] [data-blok-popover-item-description]')).toBeNull();
    control.destroy();
  });
});
