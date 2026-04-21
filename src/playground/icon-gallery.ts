interface RenderIconGalleryOptions {
  container: HTMLElement;
  iconGroups: Record<string, string[]>;
  icons: Record<string, string>;
}

const LIGHTBOX_TESTID = 'icon-lightbox';

interface IconEntry {
  name: string;
  svg: string;
}

function openLightbox(entries: IconEntry[], startIndex: number): void {
  document.querySelector(`[data-testid="${LIGHTBOX_TESTID}"]`)?.remove();

  const { name, svg } = entries[startIndex];

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
  preview.setAttribute('data-bg', 'transparent');
  preview.innerHTML = svg;

  const initialSvg = preview.querySelector('svg');

  if (initialSvg) {
    initialSvg.setAttribute('width', '96');
    initialSvg.setAttribute('height', '96');
  }

  const label = document.createElement('div');

  label.className = 'icon-lightbox__name';
  label.textContent = name;

  const controls = document.createElement('div');

  controls.className = 'icon-lightbox__controls';

  const sizeField = document.createElement('label');

  sizeField.className = 'icon-lightbox__field';

  const sizeLabel = document.createElement('span');

  sizeLabel.className = 'icon-lightbox__field-label';
  sizeLabel.textContent = 'Size';

  const sizeValue = document.createElement('span');

  sizeValue.className = 'icon-lightbox__field-value';
  sizeValue.textContent = '96';

  const sizeSlider = document.createElement('input');

  sizeSlider.type = 'range';
  sizeSlider.min = '16';
  sizeSlider.max = '128';
  sizeSlider.step = '4';
  sizeSlider.value = '96';
  sizeSlider.className = 'icon-lightbox__slider';
  sizeSlider.setAttribute('data-control', 'size');

  sizeSlider.addEventListener('input', () => {
    const next = sizeSlider.value;
    const svgEl = preview.querySelector('svg');

    if (svgEl) {
      svgEl.setAttribute('width', next);
      svgEl.setAttribute('height', next);
    }

    sizeValue.textContent = next;
  });

  sizeField.appendChild(sizeLabel);
  sizeField.appendChild(sizeSlider);
  sizeField.appendChild(sizeValue);
  controls.appendChild(sizeField);

  const colorField = document.createElement('label');

  colorField.className = 'icon-lightbox__field';

  const colorLabel = document.createElement('span');

  colorLabel.className = 'icon-lightbox__field-label';
  colorLabel.textContent = 'Color';

  const colorInput = document.createElement('input');

  colorInput.type = 'color';
  colorInput.value = '#1a1a1a';
  colorInput.className = 'icon-lightbox__color';
  colorInput.setAttribute('data-control', 'color');

  colorInput.addEventListener('input', () => {
    preview.style.color = colorInput.value;
  });

  colorField.appendChild(colorLabel);
  colorField.appendChild(colorInput);
  controls.appendChild(colorField);

  const toolbar = document.createElement('div');

  toolbar.className = 'icon-lightbox__toolbar';

  const feedback = document.createElement('div');

  feedback.className = 'icon-lightbox__feedback';
  feedback.setAttribute('data-testid', 'icon-lightbox-feedback');

  const feedbackTimer: { current: ReturnType<typeof setTimeout> | null } = { current: null };

  const flashFeedback = (message: string): void => {
    feedback.textContent = message;
    feedback.classList.add('icon-lightbox__feedback--visible');

    if (feedbackTimer.current !== null) {
      clearTimeout(feedbackTimer.current);
    }

    feedbackTimer.current = setTimeout(() => {
      feedback.classList.remove('icon-lightbox__feedback--visible');
    }, 1400);
  };

  const copySvgButton = document.createElement('button');

  copySvgButton.type = 'button';
  copySvgButton.className = 'icon-lightbox__btn';
  copySvgButton.setAttribute('data-action', 'copy-svg');
  copySvgButton.textContent = 'Copy SVG';
  copySvgButton.addEventListener('click', () => {
    void navigator.clipboard?.writeText(svg);
    flashFeedback('Copied SVG');
  });

  const copyNameButton = document.createElement('button');

  copyNameButton.type = 'button';
  copyNameButton.className = 'icon-lightbox__btn';
  copyNameButton.setAttribute('data-action', 'copy-name');
  copyNameButton.textContent = 'Copy Name';
  copyNameButton.addEventListener('click', () => {
    void navigator.clipboard?.writeText(name);
    flashFeedback('Copied name');
  });

  const downloadButton = document.createElement('button');

  downloadButton.type = 'button';
  downloadButton.className = 'icon-lightbox__btn';
  downloadButton.setAttribute('data-action', 'download');
  downloadButton.textContent = 'Download SVG';
  downloadButton.addEventListener('click', () => {
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = `${name}.svg`;
    anchor.click();
    URL.revokeObjectURL(url);
    flashFeedback('Downloaded');
  });

  const bgCycle = ['transparent', 'light', 'dark'] as const;
  const bgState = { index: 0 };

  const bgButton = document.createElement('button');

  bgButton.type = 'button';
  bgButton.className = 'icon-lightbox__btn';
  bgButton.setAttribute('data-action', 'toggle-bg');
  bgButton.textContent = 'BG: transparent';
  bgButton.addEventListener('click', () => {
    bgState.index = (bgState.index + 1) % bgCycle.length;
    const next = bgCycle[bgState.index];

    preview.setAttribute('data-bg', next);
    bgButton.textContent = `BG: ${next}`;
  });

  toolbar.appendChild(copySvgButton);
  toolbar.appendChild(copyNameButton);
  toolbar.appendChild(downloadButton);
  toolbar.appendChild(bgButton);

  content.appendChild(preview);
  content.appendChild(label);
  content.appendChild(controls);
  content.appendChild(toolbar);
  content.appendChild(feedback);
  lightbox.appendChild(content);
  document.body.appendChild(lightbox);

  const state = { closing: false };

  const close = (): void => {
    if (state.closing) {
      return;
    }

    state.closing = true;
    document.removeEventListener('keydown', onKeydown);
    lightbox.classList.add('icon-lightbox--closing');

    content.addEventListener('animationend', () => {
      lightbox.remove();
    }, { once: true });
  };

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      close();

      return;
    }

    if (event.key === 'ArrowRight') {
      const nextIndex = (startIndex + 1) % entries.length;

      openLightbox(entries, nextIndex);

      return;
    }

    if (event.key === 'ArrowLeft') {
      const prevIndex = (startIndex - 1 + entries.length) % entries.length;

      openLightbox(entries, prevIndex);
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

function buildEntries(iconGroups: Record<string, string[]>, icons: Record<string, string>): IconEntry[] {
  return Object.values(iconGroups)
    .flat()
    .flatMap((iconName) => {
      const iconSvg = icons[iconName];

      return iconSvg ? [{ name: iconName, svg: iconSvg }] : [];
    });
}

function createIconCell(name: string, svg: string, entries: IconEntry[]): HTMLElement {
  const cell = document.createElement('div');

  cell.className = 'icon-cell';

  const preview = document.createElement('div');

  preview.className = 'icon-preview';
  preview.innerHTML = svg;

  const previewSvg = preview.querySelector('svg');

  if (previewSvg && !previewSvg.hasAttribute('width') && !previewSvg.hasAttribute('height')) {
    previewSvg.setAttribute('width', '20');
    previewSvg.setAttribute('height', '20');
  }

  const label = document.createElement('div');

  label.className = 'icon-name';
  label.textContent = name;

  cell.appendChild(preview);
  cell.appendChild(label);

  const entryIndex = entries.findIndex((entry) => entry.name === name);

  cell.addEventListener('click', () => {
    openLightbox(entries, entryIndex);
  });

  return cell;
}

function createIconGroup(
  groupName: string,
  iconNames: string[],
  icons: Record<string, string>,
  entries: IconEntry[]
): HTMLElement {
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

    if (svg) {
      grid.appendChild(createIconCell(name, svg, entries));
    }
  }

  group.appendChild(grid);

  return group;
}

export function renderIconGallery({ container, iconGroups, icons }: RenderIconGalleryOptions): void {
  const entries = buildEntries(iconGroups, icons);

  for (const [groupName, iconNames] of Object.entries(iconGroups)) {
    container.appendChild(createIconGroup(groupName, iconNames, icons, entries));
  }
}
