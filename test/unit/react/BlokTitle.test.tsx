import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render as rtlRender, act, waitFor } from '@testing-library/react';
import React, { StrictMode, useState } from 'react';

import { BlokEditor } from '../../../packages/react/src/BlokEditor';
import { BlokTitle } from '../../../packages/react/src/BlokTitle';
import { Paragraph } from '../../../src/tools/paragraph';
import type { Blok } from '@/types';

const TOOLS = { paragraph: { class: Paragraph } };
const HEADER = '[data-blok-page-header]';

const unmounts: Array<() => void> = [];

const render = (ui: React.ReactElement): ReturnType<typeof rtlRender> => {
  const result = rtlRender(ui);

  unmounts.push(result.unmount);

  return result;
};

interface HarnessProps {
  showTitle?: boolean;
  deps?: unknown[];
  onEditor?: (editor: Blok | null) => void;
}

/** The documented wiring: a state setter as the BlokEditor ref. */
function Harness({ showTitle = true, deps, onEditor }: HarnessProps): React.ReactElement {
  const [editor, setEditor] = useState<Blok | null>(null);

  onEditor?.(editor);

  return (
    <>
      {showTitle ? <BlokTitle editor={editor} data-testid="title-host" /> : null}
      <BlokEditor ref={setEditor} tools={TOOLS} pageTitle deps={deps} data-testid="editor-host" />
    </>
  );
}

const titleHost = (): HTMLElement => {
  const host = document.querySelector<HTMLElement>('[data-testid="title-host"]');

  if (host === null) {
    throw new Error('no title host');
  }

  return host;
};

const waitForHeaderIn = async (host: () => HTMLElement): Promise<void> => {
  await waitFor(() => expect(host().querySelector(HEADER)).not.toBeNull(), { timeout: 5000 });
};

describe('BlokTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    unmounts.splice(0).forEach((unmount) => unmount());
    // useBlok defers destroy by a timer; flush it so editors do not leak into the next test.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders an empty div for a null editor', () => {
    render(<BlokTitle editor={null} data-testid="title-host" />);

    expect(titleHost().tagName).toBe('DIV');
    expect(titleHost().childNodes).toHaveLength(0);
  });

  it('puts the header inside its div once the editor is ready', async () => {
    render(<Harness />);

    await waitForHeaderIn(titleHost);

    expect(titleHost().querySelectorAll(HEADER)).toHaveLength(1);
  });

  it('holds exactly one header under StrictMode', async () => {
    render(
      <StrictMode>
        <Harness />
      </StrictMode>
    );

    await waitForHeaderIn(titleHost);

    expect(document.querySelectorAll(HEADER)).toHaveLength(1);
    expect(titleHost().querySelectorAll(HEADER)).toHaveLength(1);
  });

  it('puts the header back above the first block when it unmounts while the editor lives', async () => {
    const seen: { editor: Blok | null } = { editor: null };
    const onEditor = (editor: Blok | null): void => {
      seen.editor = editor;
    };
    const { rerender } = render(<Harness onEditor={onEditor} />);

    await waitForHeaderIn(titleHost);
    const editor = seen.editor;

    if (editor === null) {
      throw new Error('no editor');
    }
    const host = titleHost();
    const connectedAtUnmount: boolean[] = [];
    const realMount = editor.title.mount.bind(editor.title);

    vi.spyOn(editor.title, 'mount').mockImplementation((holder) => {
      if (holder === null) {
        connectedAtUnmount.push(host.isConnected);
      }
      realMount(holder);
    });

    rerender(<Harness onEditor={onEditor} showTitle={false} />);

    const header = document.querySelector(HEADER);
    const wrapper = document.querySelector('[data-testid="editor-host"] [data-blok-editor]');
    const redactor = wrapper?.querySelector('[data-blok-redactor]');

    expect(header?.parentElement).toBe(wrapper);
    expect(header?.nextElementSibling).toBe(redactor);
    // The header is never detached between the div's removal and mount(null).
    expect(connectedAtUnmount).toEqual([true]);
  });

  it('works with the documented state-setter ref', async () => {
    const seen: { editor: Blok | null } = { editor: null };

    render(
      <Harness
        onEditor={(editor) => {
          seen.editor = editor;
        }}
      />
    );

    await waitForHeaderIn(titleHost);

    expect(seen.editor?.title.get()).toBe('');
  });

  it('takes the new editor header when the editor is recreated', async () => {
    const { rerender } = render(<Harness deps={['a']} />);

    await waitForHeaderIn(titleHost);
    const oldHeader = titleHost().querySelector(HEADER);

    rerender(<Harness deps={['b']} />);

    await waitFor(
      () => {
        const current = titleHost().querySelector(HEADER);

        expect(current).not.toBeNull();
        expect(current).not.toBe(oldHeader);
      },
      { timeout: 5000 }
    );

    expect(titleHost().querySelectorAll(HEADER)).toHaveLength(1);
    expect(document.querySelectorAll(HEADER)).toHaveLength(1);
  });

  it('passes extra div props through', () => {
    render(<BlokTitle editor={null} data-testid="title-host" className="page-title" id="title" />);

    expect(titleHost().className).toBe('page-title');
    expect(titleHost().id).toBe('title');
  });

  it('renders no children', () => {
    const props = { editor: null, 'data-testid': 'title-host', children: <span>child</span> };

    render(<BlokTitle {...props} />);

    expect(titleHost().childNodes).toHaveLength(0);
  });
});
