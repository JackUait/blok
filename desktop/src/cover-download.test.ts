import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createPageCover} from './cover';
import {downloadImage} from '../../src/tools/image/download';
vi.mock('../../src/tools/image/download', () => ({downloadImage: vi.fn()}));
describe('cover downloads', () => {
  beforeEach(() => { vi.mocked(downloadImage).mockReset().mockResolvedValue(undefined); });
  afterEach(() => { document.body.replaceChildren(); });
  function mount(value: string, resolveUrl?: (url: string) => Promise<string>) {
    const root = createPageCover(value, 50, vi.fn(), vi.fn(), {resolveUrl});
    document.body.append(root);
    return root.querySelector<HTMLButtonElement>('[data-cover-download]')!;
  }
  it('exports a built-in gradient as an SVG file', async () => {
    const button = mount('dusk'); button.click();
    await vi.waitFor(() => expect(downloadImage).toHaveBeenCalled());
    const [url, name, options] = vi.mocked(downloadImage).mock.calls[0];
    expect(url).toMatch(/^data:image\/svg\+xml,/);
    expect(decodeURIComponent(url)).toContain('#24304b');
    expect(name).toBe('dusk.svg'); expect(options).toEqual({fallback:false});
  });
  it('resolves private images and ignores a second click while downloading', async () => {
    let finish!: () => void;
    vi.mocked(downloadImage).mockImplementation(() => new Promise(resolve => {finish=resolve;}));
    const resolve = vi.fn(async () => 'https://workspace.test/files/cover.png?grant=signed');
    const button = mount('https://workspace.test/files/cover.png', resolve);
    button.click(); button.click();
    await vi.waitFor(() => expect(downloadImage).toHaveBeenCalledTimes(1));
    expect(downloadImage).toHaveBeenCalledWith('https://workspace.test/files/cover.png?grant=signed', undefined, {fallback:false});
    expect(button.disabled).toBe(true); finish();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
  });
  it('shows a retryable error when an external host refuses the image', async () => {
    vi.mocked(downloadImage).mockRejectedValue(new TypeError('CORS'));
    const button = mount('https://external.test/image.jpg'); button.click();
    await vi.waitFor(() => expect(button.querySelector<HTMLElement>('[role=status]')?.hidden).toBe(false));
    expect(button.textContent).toContain('Téléchargement impossible');
    expect(button.disabled).toBe(false);
  });
});
