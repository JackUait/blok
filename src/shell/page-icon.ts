/** Render a workspace icon using DOM nodes, never user-provided markup. */
export function renderPageIcon(target: HTMLElement, icon: string): void {
  target.replaceChildren();
  const raster = /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i.test(icon);
  let image = raster || /^\/files\/[^\s]+$/.test(icon);
  if (!image) {
    try {
      const url = new URL(icon);
      image = (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password;
    } catch { /* Unicode emoji. */ }
  }
  if (!image) { target.textContent = icon; return; }
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
