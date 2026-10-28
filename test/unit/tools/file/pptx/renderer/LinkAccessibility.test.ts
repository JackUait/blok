import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../helpers/domShims';
import { parsePicNode } from '../../../../../../src/tools/file/pptx/model/nodes/PicNode';
import { parseShapeNode } from '../../../../../../src/tools/file/pptx/model/nodes/ShapeNode';
import { parseXml } from '../../../../../../src/tools/file/pptx/parser/XmlParser';
import type { RenderContext } from '../../../../../../src/tools/file/pptx/renderer/RenderContext';
import { renderImage } from '../../../../../../src/tools/file/pptx/renderer/ImageRenderer';
import { renderShape } from '../../../../../../src/tools/file/pptx/renderer/ShapeRenderer';
import { renderTextBody } from '../../../../../../src/tools/file/pptx/renderer/TextRenderer';
import { createMockRenderContext } from '../helpers/mockContext';
import { xmlNode } from '../helpers/xmlNode';

const NS =
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const XFRM = '<a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="952500"/></a:xfrm>';
const SLIDE_JUMP = '<a:hlinkClick r:id="rIdJump" action="ppaction://hlinksldjump"/>';
const URL_LINK = '<a:hlinkClick r:id="rIdUrl"/>';

function cNvPr(attrs: string, link: string): string {
  return `<p:cNvPr id="2" name="item"${attrs}>${link}</p:cNvPr>`;
}

function picture(options: { attrs?: string; link?: string; geometry?: string } = {}) {
  return parsePicNode(
    parseXml(
      `<p:pic ${NS}><p:nvPicPr>${cNvPr(options.attrs ?? '', options.link ?? '')}<p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${XFRM}<a:prstGeom prst="${options.geometry ?? 'rect'}"/></p:spPr></p:pic>`,
    ),
  );
}

function shape(link: string) {
  return parseShapeNode(
    parseXml(
      `<p:sp ${NS}><p:nvSpPr>${cNvPr('', link)}<p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${XFRM}<a:prstGeom prst="rect"/></p:spPr></p:sp>`,
    ),
  );
}

function context(onNavigate?: RenderContext['onNavigate']): RenderContext {
  const ctx = createMockRenderContext({ onNavigate });
  ctx.slide.slidePath = 'ppt/slides/slide1.xml';
  ctx.slide.rels.set('rIdImage', { type: 'image', target: '../media/image1.png' });
  ctx.slide.rels.set('rIdJump', { type: 'slide', target: 'slide2.xml' });
  ctx.slide.rels.set('rIdUrl', {
    type: 'hyperlink',
    target: 'https://example.com/details',
    targetMode: 'External',
  });
  ctx.slide.rels.set('rIdMedia', { type: 'media', target: '../media/clip.mp3' });
  ctx.presentation.slides = [
    ctx.slide,
    { ...ctx.slide, index: 1, slidePath: 'ppt/slides/slide2.xml', rels: new Map() },
  ];
  ctx.presentation.media.set('ppt/media/image1.png', new Uint8Array([137, 80, 78, 71]));
  ctx.presentation.media.set('ppt/media/clip.mp3', new Uint8Array([1]));

  return ctx;
}

function press(el: HTMLElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

  el.dispatchEvent(event);

  return event;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const renderers = {
  picture: (link: string, ctx: RenderContext) => renderImage(picture({ link }), ctx),
  shape: (link: string, ctx: RenderContext) => renderShape(shape(link), ctx),
};

describe.each(Object.entries(renderers))('%s links', (_kind, render) => {
  it.each([
    ['slide jump', SLIDE_JUMP, { slideIndex: 1 }],
    ['web link', URL_LINK, { url: 'https://example.com/details' }],
  ] as const)('a %s is a focusable link', (_label, link, target) => {
    const onNavigate = vi.fn();
    const el = render(link, context(onNavigate));

    expect(el.getAttribute('role')).toBe('link');
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(onNavigate).not.toHaveBeenCalled();

    el.click();

    expect(onNavigate).toHaveBeenCalledWith(target);
  });

  it.each([
    ['Enter', 'Enter'],
    ['Space', ' '],
  ])('%s follows a slide jump and a web link', (_label, key) => {
    const onNavigate = vi.fn();

    const jumpEvent = press(render(SLIDE_JUMP, context(onNavigate)), key);
    const urlEvent = press(render(URL_LINK, context(onNavigate)), key);

    expect(onNavigate.mock.calls).toEqual([[{ slideIndex: 1 }], [{ url: 'https://example.com/details' }]]);
    expect(jumpEvent.defaultPrevented).toBe(true);
    expect(urlEvent.defaultPrevented).toBe(true);
  });

  it('ignores other keys', () => {
    const onNavigate = vi.fn();
    const el = render(SLIDE_JUMP, context(onNavigate));

    const event = press(el, 'a');

    expect(onNavigate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('is not a link when the target is unsafe or navigation is off', () => {
    const unsafe = context(vi.fn());

    unsafe.slide.rels.set('rIdUrl', { type: 'hyperlink', target: 'javascript:alert(1)', targetMode: 'External' });

    for (const el of [render(URL_LINK, unsafe), render(SLIDE_JUMP, context())]) {
      expect(el.hasAttribute('role')).toBe(false);
      expect(el.hasAttribute('tabindex')).toBe(false);
    }
  });

  it('takes its name from the deck tooltip and adds no text of its own', () => {
    const withTooltip = render(
      '<a:hlinkClick r:id="rIdJump" action="ppaction://hlinksldjump" tooltip="Back to agenda"/>',
      context(vi.fn()),
    );
    const without = render(SLIDE_JUMP, context(vi.fn()));

    expect(withTooltip.getAttribute('title')).toBe('Back to agenda');
    expect(without.hasAttribute('title')).toBe(false);
    expect(without.hasAttribute('aria-label')).toBe(false);
    expect(without.textContent).toBe('');
  });
});

describe('picture alt text', () => {
  it('uses the deck description as alt', () => {
    const el = renderImage(picture({ attrs: ' descr="Team photo"' }), context());

    expect(el.querySelector('img')?.getAttribute('alt')).toBe('Team photo');
  });

  it('marks a picture without a description as decorative', () => {
    const el = renderImage(picture(), context());

    expect(el.querySelector('img')?.getAttribute('alt')).toBe('');
  });

  it('gives an audio poster the deck description', () => {
    const node = picture({ attrs: ' descr="Intro jingle"' });

    node.isAudio = true;
    node.mediaRId = 'rIdMedia';

    const el = renderImage(node, context());

    expect(el.querySelector('audio')).not.toBeNull();
    expect(el.querySelector('img')?.getAttribute('alt')).toBe('Intro jingle');
  });

  it('names a picture clipped to a shape after the deck description', () => {
    const named = renderImage(picture({ attrs: ' descr="Team photo"', geometry: 'ellipse' }), context());
    const unnamed = renderImage(picture({ geometry: 'ellipse' }), context());

    expect(named.querySelector('svg')?.getAttribute('role')).toBe('img');
    expect(named.querySelector('svg')?.getAttribute('aria-label')).toBe('Team photo');
    expect(unnamed.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('text run links', () => {
  it('drops a run link that points at a javascript: URL', () => {
    const ctx = createMockRenderContext();

    ctx.slide.rels.set('rIdUrl', { type: 'hyperlink', target: 'javascript:alert(1)', targetMode: 'External' });

    const container = document.createElement('div');

    renderTextBody(
      {
        paragraphs: [
          {
            runs: [
              {
                text: 'Click me',
                properties: xmlNode(
                  '<rPr xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><hlinkClick r:id="rIdUrl"/></rPr>',
                ),
              },
            ],
            level: 0,
          },
        ],
      },
      undefined,
      ctx,
      container,
    );

    const run = Array.from(container.querySelectorAll('span')).find((span) => span.textContent === 'Click me');

    // A kept link would underline the run and paint it in the theme's hlink colour.
    expect(run?.style.textDecoration ?? '').not.toContain('underline');
    expect(run?.style.color).not.toBe('rgb(5, 99, 193)');
    expect(container.querySelector('a')).toBeNull();
  });
});
