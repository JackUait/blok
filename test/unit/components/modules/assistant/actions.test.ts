import { describe, expect, it } from 'vitest';

import { assistantActions } from '../../../../../src/components/modules/assistant/actions';

const t = (key: string): string => `<${key}>`;

describe('assistantActions', () => {
  it('offers edits of the selected text when text is selected', () => {
    const labels = assistantActions('selection', t).map((action) => action.label);

    expect(labels).toEqual([
      '<assistant.action.improve>',
      '<assistant.action.proofread>',
      '<assistant.action.shorter>',
      '<assistant.action.longer>',
      '<assistant.action.simplify>',
      '<assistant.action.explain>',
    ]);
  });

  it('offers work on the whole page at a caret', () => {
    const labels = assistantActions('caret', t).map((action) => action.label);

    expect(labels).toEqual([
      '<assistant.action.summarize>',
      '<assistant.action.actionItems>',
      '<assistant.action.proofread>',
      '<assistant.action.continue>',
    ]);
  });

  it('offers nothing on an empty page: there is nothing to work on', () => {
    expect(assistantActions('empty', t)).toEqual([]);
  });

  it('keeps answers out of the page: summary, action items and explain only reply', () => {
    const answers = [...assistantActions('selection', t), ...assistantActions('caret', t)]
      .filter((action) => /summarize|actionItems|explain/.test(action.label));

    expect(answers).toHaveLength(3);
    answers.forEach((action) => expect(action.prompt).toContain('Do not edit the document.'));
  });

  it('asks for the document language, since the prompts are English', () => {
    [...assistantActions('selection', t), ...assistantActions('caret', t)]
      .forEach((action) => expect(action.prompt).toContain('language of the document'));
  });

  it('uses the host list instead of the built-in one', () => {
    const host = [
      { label: 'Translate', prompt: 'Translate it.', context: 'selection' as const },
      { label: 'Title', prompt: 'Suggest a title.', context: 'caret' as const },
      { label: 'Tone', prompt: 'Make it friendly.' },
    ];

    expect(assistantActions('selection', t, host)).toEqual([
      { label: 'Translate', prompt: 'Translate it.' },
      { label: 'Tone', prompt: 'Make it friendly.' },
    ]);
    expect(assistantActions('caret', t, host)).toEqual([
      { label: 'Title', prompt: 'Suggest a title.' },
      { label: 'Tone', prompt: 'Make it friendly.' },
    ]);
  });

  it('shows caret host actions on an empty page too: a host may offer drafts there', () => {
    const host = [
      { label: 'Draft', prompt: 'Draft a plan.', context: 'caret' as const },
      { label: 'Translate', prompt: 'Translate it.', context: 'selection' as const },
    ];

    expect(assistantActions('empty', t, host)).toEqual([{ label: 'Draft', prompt: 'Draft a plan.' }]);
  });

  it('hides every action for an empty host list', () => {
    expect(assistantActions('caret', t, [])).toEqual([]);
  });
});
