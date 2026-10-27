// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { webTools } from '../../../scripts/dev-web.mjs';

const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

/** Every name resolves to a public address unless a test says otherwise. */
const lookup = async (): Promise<Array<{ address: string }>> => [{ address: '93.184.215.14' }];

const urlOf = (input: RequestInfo | URL): URL => new URL(input instanceof Request ? input.url : input);

const signal = (): AbortSignal => new AbortController().signal;

describe('webTools', () => {
  it('image_search returns direct file URLs from Wikimedia Commons, with author and license', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => json({ query: { pages: { 1: {
      title: 'File:Red Panda.jpg',
      imageinfo: [{
        url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Red_Panda.jpg',
        thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Red_Panda.jpg/1280px-Red_Panda.jpg',
        descriptionurl: 'https://commons.wikimedia.org/wiki/File:Red_Panda.jpg',
        width: 4000,
        height: 3000,
        extmetadata: { Artist: { value: '<a href="x">Jane Doe</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } },
      }],
    } } } }));
    const text = await webTools({ fetch, lookup })('image_search', { query: 'red panda' }, signal());
    const url = urlOf(fetch.mock.calls[0][0]);

    expect(url.host).toBe('commons.wikimedia.org');
    expect(text).toContain('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Red_Panda.jpg/1280px-Red_Panda.jpg');
    expect(text).toContain('Jane Doe');
    expect(text).toContain('CC BY-SA 4.0');
    expect(text).not.toContain('<a ');
  });

  it('image_search decodes each entity once, so an escaped entity stays literal', async () => {
    const fetch = vi.fn(async () => json({ query: { pages: { 1: {
      title: 'File:x.jpg',
      imageinfo: [{
        url: 'https://upload.wikimedia.org/x.jpg',
        descriptionurl: 'https://commons.wikimedia.org/',
        width: 1,
        height: 1,
        extmetadata: { Artist: { value: 'Tom &amp;lt;3 &amp;amp; Jerry &lt;b&gt;' } },
      }],
    } } } }));
    const text = await webTools({ fetch, lookup })('image_search', { query: 'x' }, signal());

    expect(text).toContain('Author: Tom &lt;3 &amp; Jerry <b>');
  });

  it('image_search lists images in search rank, not page-id order', async () => {
    const page = (title: string, index: number): Record<string, unknown> => ({
      title: `File:${title}`,
      index,
      imageinfo: [{ url: `https://upload.wikimedia.org/${title}`, descriptionurl: 'https://commons.wikimedia.org/', width: 1, height: 1 }],
    });
    const fetch = vi.fn(async () => json({ query: { pages: { 1: page('second.jpg', 2), 2: page('first.jpg', 1) } } }));
    const text = await webTools({ fetch, lookup })('image_search', { query: 'x' }, signal());

    expect(text.indexOf('first.jpg')).toBeLessThan(text.indexOf('second.jpg'));
  });

  it('web_fetch returns a page as plain text with its title', async () => {
    const fetch = vi.fn(async () => new Response(
      '<html><head><title>Red panda facts</title><style>p{}</style></head><body><script>x()</script><p>Eats bamboo.</p></body></html>',
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    ));
    const text = await webTools({ fetch, lookup })('web_fetch', { url: 'https://example.com/panda' }, signal());

    expect(text).toContain('Red panda facts');
    expect(text).toContain('Eats bamboo.');
    expect(text).not.toContain('x()');
    expect(text).not.toContain('p{}');
  });

  it('web_fetch says an image loads, so the model can check a URL before it inserts it', async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'image/jpeg' } }));
    const text = await webTools({ fetch, lookup })('web_fetch', { url: 'https://example.com/a.jpg' }, signal());

    expect(text).toContain('200');
    expect(text).toContain('image/jpeg');
  });

  it('web_fetch reports a broken link by its status', async () => {
    const fetch = vi.fn(async () => new Response('gone', { status: 404, headers: { 'Content-Type': 'text/plain' } }));

    await expect(webTools({ fetch, lookup })('web_fetch', { url: 'https://example.com/missing.jpg' }, signal())).rejects.toThrow(/404/);
  });

  it.each(['http://localhost:3000/', 'http://127.0.0.1/', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://169.254.169.254/', 'http://[::1]/', 'file:///etc/passwd',
    'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://198.18.0.1/', 'http://[64:ff9b::7f00:1]/', 'http://[2002:7f00:1::]/', 'http://[fe80::1]/'])(
    'web_fetch refuses %s, so the model cannot reach this machine or its network',
    async (url) => {
      const fetch = vi.fn();

      await expect(webTools({ fetch, lookup })('web_fetch', { url }, signal())).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it('web_fetch refuses a public name that points at this machine', async () => {
    const fetch = vi.fn();
    const local = async (): Promise<Array<{ address: string }>> => [{ address: '127.0.0.1' }];

    await expect(webTools({ fetch, lookup: local })('web_fetch', { url: 'https://rebound.example/' }, signal())).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('web_fetch checks every redirect hop, so a public page cannot bounce it inward', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1:4800/ai' } }));

    await expect(webTools({ fetch, lookup })('web_fetch', { url: 'https://example.com/' }, signal())).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('web_fetch stops reading a huge page at a byte cap', async () => {
    const chunk = new TextEncoder().encode(`<p>${'a'.repeat(65_536)}</p>`);
    const endless = new ReadableStream<Uint8Array>({ pull: (controller) => controller.enqueue(chunk) });
    const fetch = vi.fn(async () => new Response(endless, { status: 200, headers: { 'Content-Type': 'text/html' } }));

    const text = await webTools({ fetch, lookup })('web_fetch', { url: 'https://example.com/' }, signal());

    expect(text.length).toBeLessThan(25_000);
  });

  it('web_fetch checks the address it connects to, so a name that re-resolves inward is refused', async () => {
    const answers = ['93.184.215.14', '127.0.0.1'];
    const rebinding = async (): Promise<Array<{ address: string }>> => [{ address: answers.shift() ?? '127.0.0.1' }];

    await expect(webTools({ lookup: rebinding })('web_fetch', { url: 'http://rebind.example:1/' }, signal())).rejects.toThrow(/private/);
  });

  it('throws on an unknown tool', async () => {
    await expect(webTools({ fetch: vi.fn(), lookup })('web_nope', {}, signal())).rejects.toThrow(/web_nope/);
  });

  it('leaves web_search to the provider', async () => {
    await expect(webTools({ fetch: vi.fn(), lookup })('web_search', { query: 'x' }, signal())).rejects.toThrow('Unknown web tool: web_search');
  });
});
