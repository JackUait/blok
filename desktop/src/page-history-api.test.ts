import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {createPageHistoryApi} from './page-history-api';

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const point = {lineage:'epoch',sequence:7};
it('uses document-scoped tickets and refreshes an expired ticket once', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', {status:401})).mockResolvedValueOnce(Response.json({lineages:[],versions:[]}));
  vi.stubGlobal('fetch', fetcher);
  const ticket = vi.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('fresh');
  const api = createPageHistoryApi({server:'https://blok.test/api/blok',doc:'page/a',ticket});
  expect(await api.list('15')).toEqual({lineages:[],versions:[]});
  expect(fetcher.mock.calls[1]?.[0]).toBe('https://blok.test/api/blok/sync/page%2Fa/history?group=15');
  expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get('Authorization')).toBe('Bearer fresh');
  expect(ticket).toHaveBeenCalledTimes(2);
});
it('pins restoration to the reviewed head and keeps the same operation key when authentication retries', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('',{status:401})).mockResolvedValueOnce(Response.json({})); vi.stubGlobal('fetch',fetcher);
  const api = createPageHistoryApi({server:'https://blok.test',doc:'p',ticket:async ()=>'token'});
  await api.restore(point,{expectRevision:'epoch:10',guards:[{kind:'unlock',blockId:'d'}]},'operation');
  for (const [,init] of fetcher.mock.calls) {
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('If-Match')).toBe('"epoch:10"');
    expect(headers.get('Blok-Idempotency-Key')).toBe('operation');
    expect(JSON.parse(typeof init?.body === 'string' ? init.body : '')).toEqual({confirm:['unlock']});
  }
});
it('reports access refusal and a page changed since preview without silently restoring', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('',{status:403})).mockResolvedValueOnce(new Response('',{status:412})); vi.stubGlobal('fetch',fetcher);
  const api = createPageHistoryApi({server:'https://blok.test',doc:'p',ticket:async ()=>'token'});
  await expect(api.list('15')).rejects.toThrow('accès');
  await expect(api.restore(point,{expectRevision:'epoch:10',guards:[]},'operation')).rejects.toThrow('changé');
  expect(fetcher).toHaveBeenCalledTimes(2);
});
