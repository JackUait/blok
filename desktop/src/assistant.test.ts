import { describe, expect, it } from 'vitest';
import { bindAssistantButton, createAssistantButton } from './assistant';

describe('desktop AI trigger', () => {
  it('stays available beside the floating panel and closes it', async () => {
    const panel = document.createElement('div');
    panel.hidden = true;
    panel.setAttribute('data-blok-agent-mode', 'floating');
    const button = createAssistantButton(() => { panel.hidden = !panel.hidden; });
    const observer = bindAssistantButton(button, panel);

    expect(button.hidden).toBe(false);
    expect(button.getAttribute('aria-label')).toBe('Ouvrir l’assistant IA');
    button.click();
    await Promise.resolve();
    expect(button.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('Fermer l’assistant IA');
    button.click();
    await Promise.resolve();
    expect(panel.hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');

    panel.hidden = false;
    panel.setAttribute('data-blok-agent-mode', 'full');
    await Promise.resolve();
    expect(button.hidden).toBe(true);
    observer.disconnect();
  });
});
