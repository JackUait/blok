interface RenderIconGalleryOptions {
  container: HTMLElement;
  iconGroups: Record<string, string[]>;
  icons: Record<string, string>;
}

const LIGHTBOX_TESTID = 'icon-lightbox';

function openLightbox(name: string, svg: string): void {
  document.querySelector(`[data-testid="${LIGHTBOX_TESTID}"]`)?.remove();

  const lightbox = document.createElement('div');

  lightbox.className = 'icon-lightbox';
  lightbox.setAttribute('data-testid', LIGHTBOX_TESTID);
  lightbox.setAttribute('role', 'dialog');
  lightbox.setAttribute('aria-modal', 'true');
  lightbox.setAttribute('aria-label', `${name} preview`);

  const content = document.createElement('div');

  content.className = 'icon-lightbox__content';

  const preview = document.createElement('div');

  preview.className = 'icon-lightbox__preview';
  preview.innerHTML = svg;

  const label = document.createElement('div');

  label.className = 'icon-lightbox__name';
  label.textContent = name;

  content.appendChild(preview);
  content.appendChild(label);
  lightbox.appendChild(content);
  document.body.appendChild(lightbox);

  const close = (): void => {
    lightbox.remove();
    document.removeEventListener('keydown', onKeydown);
  };

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      close();
    }
  }

  lightbox.addEventListener('click', (event) => {
    if (event.target === lightbox) {
      close();
    }
  });

  content.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  document.addEventListener('keydown', onKeydown);
}

export function renderIconGallery({ container, iconGroups, icons }: RenderIconGalleryOptions): void {
  for (const [groupName, iconNames] of Object.entries(iconGroups)) {
    const group = document.createElement('div');

    group.className = 'icon-group';

    const title = document.createElement('div');

    title.className = 'icon-group-title';
    title.textContent = groupName;
    group.appendChild(title);

    const grid = document.createElement('div');

    grid.className = 'icon-grid';

    for (const name of iconNames) {
      const svg = icons[name];

      if (!svg) {
        continue;
      }

      const cell = document.createElement('div');

      cell.className = 'icon-cell';

      const preview = document.createElement('div');

      preview.className = 'icon-preview';
      preview.innerHTML = svg;

      const label = document.createElement('div');

      label.className = 'icon-name';
      label.textContent = name;

      cell.appendChild(preview);
      cell.appendChild(label);
      grid.appendChild(cell);

      cell.addEventListener('click', () => {
        openLightbox(name, svg);
      });
    }

    group.appendChild(grid);
    container.appendChild(group);
  }
}
