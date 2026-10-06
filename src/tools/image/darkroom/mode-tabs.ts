import { rovingRadioGroup } from '../../../components/utils/roving-radio-group';

export interface ModeTabsOptions {
  /** `shortcut` is the bare letter that picks the tab; the caller listens for it. */
  modes: { key: string; label: string; shortcut?: string }[];
  panels: Record<string, HTMLElement>;
  selected: string;
  label: string;
  onSelect(key: string): void;
}

export interface ModeTabs {
  el: HTMLElement;
  /** Switches without calling onSelect. */
  select(key: string): void;
  /** Switches as a click would, onSelect included. */
  pick(key: string): void;
  destroy(): void;
}

const counter = { instances: 0 };

export function createModeTabs(o: ModeTabsOptions): ModeTabs {
  const prefix = `blok-darkroom-mode-${++counter.instances}`;
  const list = document.createElement('div');
  const st = { current: o.selected };

  list.className = 'blok-darkroom__tabs';
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', o.label);

  const tabs = o.modes.map(({ key, label, shortcut }) => {
    const tab = document.createElement('button');
    const panel = o.panels[key];

    tab.type = 'button';
    tab.className = 'blok-darkroom__tab';
    tab.id = `${prefix}-tab-${key}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('data-mode', key);
    tab.textContent = label;
    if (shortcut !== undefined) {
      tab.title = `${label} (${shortcut})`;
      tab.setAttribute('aria-keyshortcuts', shortcut);
    }
    if (panel !== undefined) {
      panel.id = panel.id === '' ? `${prefix}-panel-${key}` : panel.id;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
      tab.setAttribute('aria-controls', panel.id);
    }
    list.appendChild(tab);

    return tab;
  });

  const render = (): void => {
    o.modes.forEach(({ key }, i) => {
      const on = key === st.current;

      tabs[i].setAttribute('aria-selected', String(on));
      tabs[i].setAttribute('data-active', String(on));
      const panel = o.panels[key];

      if (panel !== undefined) panel.hidden = !on;
    });
    roving.refresh();
  };

  const choose = (key: string): void => {
    if (key === st.current) return;
    st.current = key;
    render();
    o.onSelect(key);
  };

  const roving = rovingRadioGroup({
    radios: tabs,
    getSelectedIndex: () => o.modes.findIndex((m) => m.key === st.current),
    onSelect: (i) => choose(o.modes[i].key),
  });

  const onClick = (e: MouseEvent): void => {
    const key = (e.currentTarget as HTMLElement).getAttribute('data-mode');

    if (key !== null) choose(key);
  };

  tabs.forEach((tab) => tab.addEventListener('click', onClick));
  render();

  return {
    el: list,
    select(key: string): void {
      st.current = key;
      render();
    },
    pick: choose,
    destroy(): void {
      roving.destroy();
      tabs.forEach((tab) => tab.removeEventListener('click', onClick));
    },
  };
}
