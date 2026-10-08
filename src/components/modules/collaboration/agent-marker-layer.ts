import { PRESENCE_COLOR_PROPERTY } from './presence';

const MARKER_ATTR = 'data-blok-agent-marker';
// Attribute text stays out of copied block content.
const FLAG_ATTR = 'data-blok-agent-marker-label';
const SHOWN_ATTR = 'data-blok-agent-marker-shown';
const DEFAULT_GREET_FOR_MS = 3000;

export interface AgentMarker {
  key: number;
  blockId: string;
  name: string;
  color: string;
}

export interface AgentMarkerLayer {
  render(markers: AgentMarker[]): void;
  clear(): void;
}

interface Drawn {
  holder: HTMLElement;
  outline: HTMLElement;
  flag: HTMLElement;
  greetTimer: ReturnType<typeof setTimeout> | null;
}

const inert = (element: HTMLElement): HTMLElement => {
  element.setAttribute('contenteditable', 'false');
  element.setAttribute('aria-hidden', 'true');

  return element;
};

export function createAgentMarkerLayer(options: {
  resolveHolder(blockId: string): HTMLElement | null;
  greetForMs?: number;
}): AgentMarkerLayer {
  const greetMs = options.greetForMs ?? DEFAULT_GREET_FOR_MS;
  const drawn = new Map<number, Drawn>();
  // Moving to another holder must not repeat the arrival greeting.
  const greeted = new Set<number>();

  const remove = (entry: Drawn): void => {
    if (entry.greetTimer !== null) {
      clearTimeout(entry.greetTimer);
    }

    entry.outline.remove();
    entry.flag.remove();
  };

  const paint = (entry: Drawn, marker: AgentMarker): void => {
    entry.outline.style.setProperty(PRESENCE_COLOR_PROPERTY, marker.color);
    entry.flag.style.setProperty(PRESENCE_COLOR_PROPERTY, marker.color);
    entry.flag.setAttribute(FLAG_ATTR, marker.name);
  };

  const draw = (marker: AgentMarker, holder: HTMLElement): Drawn => {
    const outline = inert(document.createElement('div'));
    const flag = inert(document.createElement('div'));
    const entry: Drawn = { holder, outline, flag, greetTimer: null };

    outline.setAttribute(MARKER_ATTR, '');
    paint(entry, marker);
    holder.append(outline, flag);

    if (!greeted.has(marker.key)) {
      greeted.add(marker.key);
      flag.setAttribute(SHOWN_ATTR, '');
      entry.greetTimer = setTimeout(() => {
        flag.removeAttribute(SHOWN_ATTR);
        entry.greetTimer = null;
      }, greetMs);
    }

    return entry;
  };

  return {
    render(markers: AgentMarker[]): void {
      const keep = new Set<number>();

      markers.forEach((marker) => {
        const holder = options.resolveHolder(marker.blockId);

        if (holder === null) {
          return;
        }

        keep.add(marker.key);

        const existing = drawn.get(marker.key);

        if (existing !== undefined && existing.holder === holder) {
          paint(existing, marker);

          return;
        }

        if (existing !== undefined) {
          remove(existing);
        }

        drawn.set(marker.key, draw(marker, holder));
      });

      drawn.forEach((entry, key) => {
        if (!keep.has(key)) {
          remove(entry);
          drawn.delete(key);
          greeted.delete(key);
        }
      });
    },

    clear(): void {
      drawn.forEach(remove);
      drawn.clear();
      greeted.clear();
    },
  };
}
