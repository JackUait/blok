import type { VideoAlignment, VideoData } from '../../../types/tools/video';
import type { I18nInstance } from '../../components/utils/tools';
import {
  IconCaptionImage,
  IconImageAlignCenter,
  IconImageAlignLeft,
  IconImageAlignRight,
  IconMoreHorizontal,
  IconReplaceImage,
} from '../../components/icons';
import { tr } from './i18n';

const ALIGN_TO_TEXT_ALIGN: Record<VideoAlignment, string> = {
  left: 'left',
  center: 'center',
  right: 'right',
};

const ALIGN_ICON: Record<VideoAlignment, string> = {
  left: IconImageAlignLeft,
  center: IconImageAlignCenter,
  right: IconImageAlignRight,
};

export function renderVideo(data: Partial<VideoData> & { url: string }): HTMLElement {
  const alignment = data.alignment ?? 'center';
  const figure = document.createElement('figure');
  figure.className = 'blok-video-inner';
  figure.setAttribute('data-role', 'video-figure');
  figure.style.margin = '0';
  figure.style.textAlign = ALIGN_TO_TEXT_ALIGN[alignment];
  figure.style.position = 'relative';
  if (data.width !== undefined) {
    figure.style.width = `${data.width}%`;
  }

  // The media wrapper hugs the player pixels and anchors the overlaid chrome
  // (custom controls, edit toolbar, resize handles) so they sit over the video
  // only — never over the caption row below.
  const media = document.createElement('div');
  media.className = 'blok-video-media';
  media.setAttribute('data-role', 'video-media');
  media.style.position = 'relative';

  // No native `controls` — a custom Airbnb-style control surface is attached
  // separately (see controls.ts) and fully replaces the browser chrome.
  const video = document.createElement('video');
  video.setAttribute('data-blok-testid', 'video-player');
  video.setAttribute('playsinline', '');
  video.setAttribute('preload', 'metadata');
  video.setAttribute('src', data.url);
  video.style.width = '100%';
  video.style.display = 'block';
  media.appendChild(video);
  figure.appendChild(media);

  return figure;
}

export interface CaptionRowOptions {
  value: string;
  placeholder: string;
  readOnly: boolean;
  onChange(next: string): void;
}

export function renderCaptionRow(opts: CaptionRowOptions): HTMLElement {
  const row = document.createElement('div');
  row.className = 'blok-video-caption-row';
  row.setAttribute('data-role', 'video-caption-row');

  const caption = document.createElement('div');
  caption.className = 'blok-video-caption';
  caption.setAttribute('data-role', 'video-caption');
  caption.setAttribute('role', 'textbox');
  caption.setAttribute('contenteditable', opts.readOnly ? 'false' : 'true');
  caption.setAttribute('data-placeholder', opts.placeholder);
  caption.textContent = opts.value;
  caption.style.outline = 'none';
  caption.style.textAlign = 'left';

  if (!opts.readOnly) {
    caption.addEventListener('blur', () => opts.onChange(caption.textContent ?? ''));
  }

  row.appendChild(caption);
  return row;
}

export interface OverlayOptions {
  alignment: VideoAlignment;
  captionVisible: boolean;
  onAlign(next: VideoAlignment): void;
  onToggleCaption(): void;
  onReplace(): void;
  onMore(trigger: HTMLElement): void;
  i18n?: I18nInstance;
}

export function renderOverlay(opts: OverlayOptions): HTMLElement {
  const root = document.createElement('div');
  root.setAttribute('data-role', 'video-overlay');
  root.className = 'blok-video-toolbar';

  appendAlignCtrl(root, opts);
  appendDivider(root);

  appendButton(root, {
    action: 'caption-toggle',
    label: tr(opts.i18n, 'tools.video.toggleCaption', 'Toggle caption'),
    icon: IconCaptionImage,
    pressed: opts.captionVisible,
    onClick: opts.onToggleCaption,
  });
  appendButton(root, {
    action: 'replace',
    label: tr(opts.i18n, 'tools.video.replace', 'Replace video'),
    icon: IconReplaceImage,
    onClick: opts.onReplace,
  });

  appendDivider(root);

  const moreLabel = tr(opts.i18n, 'tools.video.moreOptions', 'More options');
  const more = document.createElement('button');
  more.type = 'button';
  more.setAttribute('data-action', 'more');
  more.setAttribute('aria-label', moreLabel);
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  more.innerHTML = IconMoreHorizontal;
  more.addEventListener('click', (event) => {
    event.stopPropagation();
    opts.onMore(more);
  });
  root.appendChild(more);

  return root;
}

function appendAlignCtrl(root: HTMLElement, opts: OverlayOptions): void {
  const wrapper = document.createElement('div');
  wrapper.className = 'blok-video-toolbar__align';
  wrapper.style.position = 'relative';

  const current = opts.alignment;
  const alignmentText = tr(opts.i18n, 'tools.video.alignment', 'Alignment');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.setAttribute('data-action', 'align-trigger');
  trigger.setAttribute('data-current', current);
  trigger.setAttribute('aria-label', alignmentText);
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML = ALIGN_ICON[current];
  wrapper.appendChild(trigger);

  const popover = document.createElement('div');
  popover.setAttribute('data-role', 'align-popover');
  popover.setAttribute('role', 'group');
  popover.setAttribute('aria-label', alignmentText);
  popover.className = 'blok-video-toolbar__align-popover';
  popover.hidden = true;

  const labels: Record<VideoAlignment, string> = {
    left: tr(opts.i18n, 'tools.video.alignmentLeft', 'Align left'),
    center: tr(opts.i18n, 'tools.video.alignmentCenter', 'Align center'),
    right: tr(opts.i18n, 'tools.video.alignmentRight', 'Align right'),
  };

  for (const value of ['left', 'center', 'right'] as VideoAlignment[]) {
    const option = document.createElement('button');
    option.type = 'button';
    option.setAttribute('data-action', `align-${value}`);
    option.setAttribute('aria-label', labels[value]);
    option.setAttribute('aria-pressed', current === value ? 'true' : 'false');
    option.innerHTML = ALIGN_ICON[value];
    option.addEventListener('click', (event) => {
      event.stopPropagation();
      closePopover();
      opts.onAlign(value);
    });
    popover.appendChild(option);
  }

  wrapper.appendChild(popover);
  root.appendChild(wrapper);

  const onOutside = (event: MouseEvent): void => {
    if (popover.hidden) return;
    const target = event.target as Node | null;
    if (target && wrapper.contains(target)) return;
    closePopover();
  };

  const openPopover = (): void => {
    if (!popover.hidden) return;
    popover.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', onOutside);
  };

  function closePopover(): void {
    if (popover.hidden) return;
    popover.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onOutside);
  }

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (popover.hidden) openPopover();
    else closePopover();
  });
}

function appendDivider(parent: HTMLElement): void {
  const d = document.createElement('div');
  d.className = 'blok-video-toolbar__divider';
  d.setAttribute('aria-hidden', 'true');
  parent.appendChild(d);
}

interface ButtonSpec {
  action: string;
  label: string;
  icon: string;
  onClick(): void;
  pressed?: boolean;
}

function appendButton(parent: HTMLElement, spec: ButtonSpec): void {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('aria-label', spec.label);
  btn.setAttribute('data-action', spec.action);
  if (spec.pressed !== undefined) {
    btn.setAttribute('aria-pressed', spec.pressed ? 'true' : 'false');
  }
  btn.innerHTML = spec.icon;
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    spec.onClick();
  });
  parent.appendChild(btn);
}
