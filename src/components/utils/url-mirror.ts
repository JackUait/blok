/**
 * Address-bar colouring for a URL input: the input's own text is transparent
 * and a mirror behind it draws the same characters in colour. Same font and
 * size, colour only (no weight change), so the caret stays on its glyph.
 * The mirror must share the input's grid cell (see media-empty.css), so only
 * the horizontal scroll of a long link has to be copied over.
 */

export interface UrlMirror {
  element: HTMLElement;
  /** Redraws from the input's value; typing redraws on its own. */
  draw(): void;
}

/** Splits typed link text the way an address bar colours it. */
function urlParts(raw: string): Array<[string, string]> {
  const match = /^([a-z][\w+.-]*:\/\/)?(www\.)?([^/?#]*)(.*)$/i.exec(raw) ?? [];
  const parts: Array<[string, string]> = [['proto', match[1] ?? ''], ['www', match[2] ?? ''], ['host', match[3] ?? ''], ['path', match[4] ?? '']];

  return parts.filter(([, text]) => text !== '');
}

export function createUrlMirror(input: HTMLInputElement): UrlMirror {
  const element = document.createElement('span');
  const text = document.createElement('span');

  element.className = 'blok-media-empty__embed-mirror';
  element.setAttribute('aria-hidden', 'true');
  text.className = 'blok-media-empty__embed-mirror-text';
  element.append(text);
  input.classList.add('blok-media-empty__embed-input--mirrored');

  const place = (): void => {
    const scroll = input.scrollLeft;

    text.style.setProperty('--scroll', String(scroll));
    // 1px slack: a zoomed page reports fractional scroll positions.
    element.toggleAttribute('data-overflow-start', scroll > 1);
    element.toggleAttribute('data-overflow-end', input.scrollWidth - input.clientWidth - scroll > 1);
  };
  const draw = (): void => {
    text.replaceChildren(...urlParts(input.value).map(([part, value]) => {
      const span = document.createElement('span');

      span.className = `blok-media-empty__url-${part}`;
      span.textContent = value;

      return span;
    }));
    place();
  };

  input.addEventListener('input', draw);
  for (const type of ['scroll', 'keyup', 'select', 'focus', 'blur']) {
    input.addEventListener(type, place);
  }

  return { element, draw };
}
