import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountRemoteAssets } from './remote-assets';
import type { API, BlockAPI } from '../../types';
const server = 'https://example.org';
const canonical = `${server}/files/image.png`;
const signed = `${canonical}?grant=short-lived`;
const cleanups: Array<()=>void> = [];
afterEach(() => { cleanups.splice(0).forEach((fn)=>fn()); document.body.replaceChildren(); vi.restoreAllMocks(); });
describe('native private media transport', () => {
  it('renders a signed image while exporting the canonical stored URL', async () => {
    const { ImageTool } = await vi.importActual<{ImageTool: typeof import('@bloklabs/core/tools').Image}>('../../src/tools/image');
    const api = {styles:{block:'blok-block'},media:{reportFailure:vi.fn(),clearFailure:vi.fn()},i18n:{t:(key:string)=>key,has:()=>false}} as unknown as API;
    const block = {id:'image',name:'image',holder:document.createElement('div'),dispatchChange:vi.fn()} as unknown as BlockAPI;
    const image = new ImageTool({data:{url:canonical},config:{},api,block,readOnly:true});
    const root = image.render(); document.body.append(root);
    cleanups.push(mountRemoteAssets(server,async()=>signed));
    await vi.waitFor(()=>expect(root.querySelector('img')?.src).toBe(signed));
    expect(image.save(root).url).toBe(canonical);

  });
  it('signs canonical binary fetches, leaves external fetches untouched and restores transport', async () => {
    const original = vi.fn().mockResolvedValue(new Response('asset'));
    vi.stubGlobal('fetch',original);
    const resolve = vi.fn(async()=>signed);
    const destroy = mountRemoteAssets(server,resolve);
    await window.fetch(canonical);
    expect(original).toHaveBeenCalledWith(signed,undefined);
    await window.fetch('https://external.org/image.png');
    expect(resolve).toHaveBeenCalledTimes(1);
    destroy(); expect(window.fetch).toBe(original);
    vi.unstubAllGlobals();
  });
});
