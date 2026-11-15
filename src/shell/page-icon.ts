/** True when the icon is a picture to load, false when it is a glyph to draw. */
export function isImageIcon(icon: string): boolean {
  if (/^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i.test(icon)) return true;
  if (/^\/files\/[^\s]+$/.test(icon)) return true;
  try {
    const url = new URL(icon);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password;
  } catch { return false; /* Unicode emoji. */ }
}

/** Render a workspace icon using DOM nodes, never user-provided markup. */
export function renderPageIcon(target: HTMLElement, icon: string): void {
  target.replaceChildren();
  if (!isImageIcon(icon)) { target.textContent = icon; return; }
  const img = document.createElement('img');
  img.src = icon;
  img.alt = '';
  img.draggable = false;
  img.referrerPolicy = 'no-referrer';
  img.style.width = '1em';
  img.style.height = '1em';
  img.style.objectFit = 'contain';
  target.append(img);
}
