import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as ListenModule from '../../../../src/tools/audio/listen';

type Listener = ListenModule.Listener;

const HTTP_SRC = 'https://cdn.example/track.mp3';
const BLOB_SRC = 'blob:https://app.example/1b2c';
const SAMPLE_RATE = 48000;

interface FakeAnalyser {
  fftSize: number;
  smoothingTimeConstant: number;
  readonly frequencyBinCount: number;
  getByteFrequencyData: (target: Uint8Array) => void;
  connect: ReturnType<typeof vi.fn>;
}

interface FakeContext {
  sampleRate: number;
  destination: Record<string, unknown>;
  resume: ReturnType<typeof vi.fn>;
  createMediaElementSource: ReturnType<typeof vi.fn>;
  createAnalyser: ReturnType<typeof vi.fn>;
  analysers: FakeAnalyser[];
}

interface ContextOptions {
  sourceThrows?: boolean;
}

/** Installs a fake AudioContext constructor and returns every context built from it. */
function stubAudioContext(options: ContextOptions = {}): FakeContext[] {
  const contexts: FakeContext[] = [];

  const makeAnalyser = (): FakeAnalyser => ({
    fftSize: 0,
    smoothingTimeConstant: 0,
    get frequencyBinCount(): number {
      return this.fftSize / 2;
    },
    getByteFrequencyData: (target: Uint8Array): void => {
      target.fill(7);
    },
    connect: vi.fn(),
  });

  const Ctor = function FakeAudioContext(): FakeContext {
    const context: FakeContext = {
      sampleRate: SAMPLE_RATE,
      destination: {},
      resume: vi.fn(() => Promise.resolve()),
      createMediaElementSource: vi.fn(() => {
        if (options.sourceThrows === true) throw new Error('InvalidStateError');

        return { connect: vi.fn() };
      }),
      createAnalyser: vi.fn(() => {
        const analyser = makeAnalyser();

        context.analysers.push(analyser);

        return analyser;
      }),
      analysers: [],
    };

    contexts.push(context);

    return context;
  };

  vi.stubGlobal('AudioContext', Ctor);

  return contexts;
}

interface Deferred {
  resolve: (response: Response) => void;
  reject: (reason: Error) => void;
}

/** Installs a fetch that stays pending until the test settles it. */
function stubFetch(): { fetchMock: ReturnType<typeof vi.fn<typeof fetch>>; probe: Deferred } {
  const probe: Deferred = { resolve: () => undefined, reject: () => undefined };
  const fetchMock = vi.fn<typeof fetch>(
    () =>
      new Promise<Response>((resolve, reject) => {
        probe.resolve = resolve;
        probe.reject = reject;
      })
  );

  vi.stubGlobal('fetch', fetchMock);

  return { fetchMock, probe };
}

interface MediaState {
  paused: boolean;
  currentTime: number;
  readyState: number;
  networkState: number;
}

interface FakeMedia {
  media: HTMLAudioElement;
  state: MediaState;
  load: ReturnType<typeof vi.spyOn>;
  play: ReturnType<typeof vi.spyOn>;
  add: ReturnType<typeof vi.spyOn>;
  remove: ReturnType<typeof vi.spyOn>;
  fire: (type: string) => void;
  /** Listeners added and not removed again. */
  leftover: () => number;
}

/** A real jsdom <audio> whose playback state the test controls. Starts at rest with its metadata loaded. */
function makeMedia(src: string): FakeMedia {
  const media = document.createElement('audio');
  const state: MediaState = { paused: true, currentTime: 0, readyState: 1, networkState: 1 };

  media.src = src;
  Object.defineProperties(media, {
    paused: { get: () => state.paused },
    currentTime: { get: () => state.currentTime },
    readyState: { get: () => state.readyState },
    networkState: { get: () => state.networkState },
  });

  const load = vi.spyOn(media, 'load').mockImplementation(() => undefined);
  const play = vi.spyOn(media, 'play').mockImplementation(() => Promise.resolve());
  const add = vi.spyOn(media, 'addEventListener');
  const remove = vi.spyOn(media, 'removeEventListener');

  const leftover = (): number => {
    const removed = remove.mock.calls.map(([type, fn]) => ({ type, fn }));

    return add.mock.calls.filter(([type, fn]) => {
      const at = removed.findIndex((r) => r.type === type && r.fn === fn);

      if (at === -1) return true;
      removed.splice(at, 1);

      return false;
    }).length;
  };

  return {
    media,
    state,
    load,
    play,
    add,
    remove,
    fire: (type) => {
      media.dispatchEvent(new Event(type));
    },
    leftover,
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const okResponse = (): Response => new Response(null, { status: 200 });

async function load(): Promise<typeof ListenModule> {
  return import('../../../../src/tools/audio/listen');
}

/** Starts playback the way the browser reports it: unpaused, then `play`. */
function startPlaying(fake: FakeMedia): void {
  const { state } = fake;

  state.paused = false;
  fake.fire('play');
}

describe('audio listen', () => {
  const listeners: Listener[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    listeners.splice(0).forEach((l) => l.destroy());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const create = async (media: HTMLAudioElement): Promise<Listener> => {
    const { createListener } = await load();
    const listener = createListener(media);

    listeners.push(listener);

    return listener;
  };

  describe('isAlwaysClean', () => {
    it('accepts blob: and data: URLs and nothing else', async () => {
      const { isAlwaysClean } = await load();

      expect(isAlwaysClean(HTTP_SRC)).toBe(false);
      expect(isAlwaysClean('/same-origin.mp3')).toBe(false);
      expect(isAlwaysClean('')).toBe(false);
      expect(isAlwaysClean(BLOB_SRC)).toBe(true);
      expect(isAlwaysClean('data:audio/wav;base64,AAAA')).toBe(true);
    });
  });

  describe('blob: source', () => {
    it('never probes and does not tap before play', async () => {
      const contexts = stubAudioContext();
      const { fetchMock } = stubFetch();
      const fake = makeMedia(BLOB_SRC);
      const listener = await create(fake.media);

      await flush();

      expect(contexts).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(listener.read()).toBeNull();
      expect(fake.media.crossOrigin).toBeNull();
    });

    it('taps on play and reads the analyser', async () => {
      const contexts = stubAudioContext();

      stubFetch();

      const fake = makeMedia(BLOB_SRC);
      const listener = await create(fake.media);

      startPlaying(fake);

      const spectrum = listener.read();

      expect(spectrum).not.toBeNull();
      expect(spectrum?.hzPerBin).toBe(SAMPLE_RATE / 2048);
      expect(spectrum?.bytes).toHaveLength(1024);
      expect(spectrum?.bytes[0]).toBe(7);
      expect(listener.read()?.bytes).toBe(spectrum?.bytes);

      const [context] = contexts;
      const [analyser] = context.analysers;

      expect(context.createMediaElementSource).toHaveBeenCalledWith(fake.media);
      expect(analyser.fftSize).toBe(2048);
      expect(analyser.smoothingTimeConstant).toBe(0.3);
      expect(analyser.connect).toHaveBeenCalledWith(context.destination);
      expect(context.createMediaElementSource.mock.results[0].value.connect).toHaveBeenCalledWith(analyser);
    });

    it('resumes the context on every play', async () => {
      const contexts = stubAudioContext();

      stubFetch();

      const fake = makeMedia(BLOB_SRC);

      await create(fake.media);
      startPlaying(fake);
      startPlaying(fake);
      startPlaying(fake);

      expect(contexts).toHaveLength(1);
      expect(contexts[0].resume).toHaveBeenCalledTimes(3);
      expect(contexts[0].createMediaElementSource).toHaveBeenCalledTimes(1);
    });
  });

  describe('http source', () => {
    it('probes in CORS mode, switches the element to CORS and aborts the probe', async () => {
      stubAudioContext();

      const { fetchMock, probe } = stubFetch();
      const fake = makeMedia(HTTP_SRC);

      await create(fake.media);

      expect(fake.media.crossOrigin).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, init] = fetchMock.mock.calls[0];

      expect(url).toBe(HTTP_SRC);
      expect(init?.mode).toBe('cors');
      expect(init?.credentials).toBe('same-origin');
      expect(init?.signal?.aborted).toBe(false);

      probe.resolve(okResponse());
      await flush();

      expect(fake.media.crossOrigin).toBe('anonymous');
      expect(init?.signal?.aborted).toBe(true);
    });

    it('requests nothing for an element that has fetched nothing, and probes at its first metadata', async () => {
      stubAudioContext();

      const { fetchMock, probe } = stubFetch();
      const fake = makeMedia(HTTP_SRC);

      fake.state.readyState = 0;
      await create(fake.media);
      await flush();

      expect(fetchMock).not.toHaveBeenCalled();

      fake.state.readyState = 1;
      fake.fire('loadedmetadata');
      probe.resolve(okResponse());
      await flush();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fake.media.crossOrigin).toBe('anonymous');
    });

    it.each([
      ['has loaded data', { readyState: 4, networkState: 1 }],
      ['is still loading more', { readyState: 1, networkState: 2 }],
    ])('reloads an element that %s, after the attribute is set', async (_name, patch) => {
      stubAudioContext();

      const { probe } = stubFetch();
      const fake = makeMedia(HTTP_SRC);

      Object.assign(fake.state, patch);
      fake.load.mockImplementation(() => {
        expect(fake.media.crossOrigin).toBe('anonymous');
      });

      await create(fake.media);
      probe.resolve(okResponse());
      await flush();

      expect(fake.load).toHaveBeenCalledTimes(1);
    });

    it('does not tap on a play that comes before the CORS load is confirmed', async () => {
      const contexts = stubAudioContext();
      const { probe } = stubFetch();
      const fake = makeMedia(HTTP_SRC);
      const listener = await create(fake.media);

      probe.resolve(okResponse());
      await flush();
      startPlaying(fake);

      expect(contexts).toHaveLength(0);
      expect(listener.read()).toBeNull();
    });

    it('taps once the CORS load is confirmed while playing', async () => {
      const contexts = stubAudioContext();
      const { probe } = stubFetch();
      const fake = makeMedia(HTTP_SRC);
      const listener = await create(fake.media);

      probe.resolve(okResponse());
      await flush();
      startPlaying(fake);
      fake.fire('loadedmetadata');

      expect(listener.read()?.hzPerBin).toBe(SAMPLE_RATE / 2048);
      expect(contexts[0].resume).toHaveBeenCalledTimes(1);
    });

    it('taps on the first play after the CORS load is confirmed', async () => {
      const contexts = stubAudioContext();
      const { probe } = stubFetch();
      const fake = makeMedia(HTTP_SRC);
      const listener = await create(fake.media);

      probe.resolve(okResponse());
      await flush();
      fake.fire('loadedmetadata');

      expect(contexts).toHaveLength(0);
      expect(listener.read()).toBeNull();

      startPlaying(fake);

      expect(listener.read()).not.toBeNull();
      expect(contexts[0].createMediaElementSource).toHaveBeenCalledTimes(1);
    });

    it('stays untouched and deaf when the probe rejects', async () => {
      const contexts = stubAudioContext();
      const { probe } = stubFetch();
      const fake = makeMedia(HTTP_SRC);
      const listener = await create(fake.media);

      probe.reject(new TypeError('Failed to fetch'));
      await flush();
      startPlaying(fake);
      fake.fire('loadedmetadata');

      expect(fake.media.crossOrigin).toBeNull();
      expect(fake.media.hasAttribute('crossorigin')).toBe(false);
      expect(contexts).toHaveLength(0);
      expect(listener.read()).toBeNull();
      expect(fake.load).not.toHaveBeenCalled();
    });

    it('stays untouched and deaf when the probe answers with an error status', async () => {
      const contexts = stubAudioContext();
      const { probe } = stubFetch();
      const fake = makeMedia(HTTP_SRC);
      const listener = await create(fake.media);

      probe.resolve(new Response(null, { status: 404 }));
      await flush();
      startPlaying(fake);
      fake.fire('loadedmetadata');

      expect(fake.media.crossOrigin).toBeNull();
      expect(contexts).toHaveLength(0);
      expect(listener.read()).toBeNull();
      expect(fake.load).not.toHaveBeenCalled();
    });

    it.each([
      ['is already playing', { paused: false }],
      ['was already played and paused midway', { currentTime: 3 }],
    ])('stays untouched and deaf when the element %s as the probe returns', async (_name, patch) => {
      const contexts = stubAudioContext();
      const { probe } = stubFetch();
      const fake = makeMedia(HTTP_SRC);
      const listener = await create(fake.media);

      Object.assign(fake.state, patch);
      probe.resolve(okResponse());
      await flush();
      startPlaying(fake);
      fake.fire('loadedmetadata');

      expect(fake.media.crossOrigin).toBeNull();
      expect(fake.load).not.toHaveBeenCalled();
      expect(contexts).toHaveLength(0);
      expect(listener.read()).toBeNull();
    });

    it('stays untouched and deaf when the src changed while the probe was in flight', async () => {
      const contexts = stubAudioContext();
      const { probe } = stubFetch();
      const fake = makeMedia(HTTP_SRC);
      const listener = await create(fake.media);

      fake.media.src = 'https://other.example/next.mp3';
      probe.resolve(okResponse());
      await flush();
      startPlaying(fake);
      fake.fire('loadedmetadata');

      expect(fake.media.crossOrigin).toBeNull();
      expect(fake.load).not.toHaveBeenCalled();
      expect(contexts).toHaveLength(0);
      expect(listener.read()).toBeNull();
    });

    it('never probes an element with no source', async () => {
      stubAudioContext();

      const { fetchMock } = stubFetch();
      const media = document.createElement('audio');

      await create(media);

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('error after the switch', () => {
    it('takes the attribute off, reloads and never taps', async () => {
      const contexts = stubAudioContext();
      const { probe } = stubFetch();
      const fake = makeMedia(HTTP_SRC);
      const listener = await create(fake.media);

      probe.resolve(okResponse());
      await flush();
      fake.load.mockImplementation(() => {
        expect(fake.media.hasAttribute('crossorigin')).toBe(false);
      });
      fake.fire('error');

      expect(fake.media.hasAttribute('crossorigin')).toBe(false);
      expect(fake.load).toHaveBeenCalledTimes(2); // the switch, then the revert
      expect(fake.play).not.toHaveBeenCalled();

      startPlaying(fake);
      fake.fire('loadedmetadata');

      expect(contexts).toHaveLength(0);
      expect(listener.read()).toBeNull();
    });

    it('starts playback again when the failed load was started by a play', async () => {
      stubAudioContext();

      const { probe } = stubFetch();
      const fake = makeMedia(HTTP_SRC);

      const order: string[] = [];

      fake.load.mockImplementation(() => {
        order.push('load');
      });
      fake.play.mockImplementation(() => {
        order.push('play');

        return Promise.resolve();
      });

      await create(fake.media);
      probe.resolve(okResponse());
      await flush();
      // A failed load leaves the element paused although play was asked for.
      fake.fire('play');
      fake.fire('error');

      expect(order).toEqual(['load', 'load', 'play']); // the switch, then the revert and replay
    });

    it('does not start playback again when the user paused before the load failed', async () => {
      stubAudioContext();

      const { probe } = stubFetch();
      const fake = makeMedia(HTTP_SRC);

      await create(fake.media);
      probe.resolve(okResponse());
      await flush();
      fake.fire('play');
      fake.fire('pause');
      fake.fire('error');

      expect(fake.play).not.toHaveBeenCalled();
      expect(fake.media.hasAttribute('crossorigin')).toBe(false);
    });

    it('leaves the element alone when the error comes after the CORS load was confirmed', async () => {
      stubAudioContext();

      const { probe } = stubFetch();
      const fake = makeMedia(HTTP_SRC);

      await create(fake.media);
      probe.resolve(okResponse());
      await flush();
      fake.fire('loadedmetadata');
      fake.fire('error');

      expect(fake.media.crossOrigin).toBe('anonymous');
      expect(fake.load).toHaveBeenCalledTimes(1); // the switch only, no revert
    });
  });

  describe('destroy', () => {
    it('before the probe resolves: aborts it, changes nothing later, leaves no listeners', async () => {
      const contexts = stubAudioContext();
      const { fetchMock, probe } = stubFetch();
      const fake = makeMedia(HTTP_SRC);
      const listener = await create(fake.media);

      listener.destroy();

      expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
      expect(fake.leftover()).toBe(0);

      probe.resolve(okResponse());
      await flush();
      startPlaying(fake);
      fake.fire('loadedmetadata');
      fake.fire('error');

      expect(fake.media.crossOrigin).toBeNull();
      expect(fake.load).not.toHaveBeenCalled();
      expect(fake.leftover()).toBe(0);
      expect(contexts).toHaveLength(0);
      expect(listener.read()).toBeNull();
    });

    it('between the switch and play: no tap, no revert on a late error, no listeners', async () => {
      const contexts = stubAudioContext();
      const { probe } = stubFetch();
      const fake = makeMedia(HTTP_SRC);
      const listener = await create(fake.media);

      probe.resolve(okResponse());
      await flush();
      listener.destroy();

      expect(fake.leftover()).toBe(0);

      fake.fire('error');
      fake.fire('loadedmetadata');
      startPlaying(fake);

      expect(fake.media.crossOrigin).toBe('anonymous');
      expect(fake.load).toHaveBeenCalledTimes(1); // the switch only, no revert
      expect(contexts).toHaveLength(0);
      expect(listener.read()).toBeNull();
    });

    it('after the tap: keeps the nodes connected and removes every listener', async () => {
      const contexts = stubAudioContext();

      stubFetch();

      const fake = makeMedia(BLOB_SRC);
      const listener = await create(fake.media);

      startPlaying(fake);
      listener.destroy();

      expect(fake.leftover()).toBe(0);
      expect(listener.read()).toBeNull();

      startPlaying(fake);

      expect(contexts[0].resume).toHaveBeenCalledTimes(1);
    });
  });

  describe('shared nodes', () => {
    it('two listeners on one element share one MediaElementSource', async () => {
      const contexts = stubAudioContext();

      stubFetch();

      const fake = makeMedia(BLOB_SRC);
      const first = await create(fake.media);
      const second = await create(fake.media);

      startPlaying(fake);

      expect(contexts).toHaveLength(1);
      expect(contexts[0].createMediaElementSource).toHaveBeenCalledTimes(1);
      expect(first.read()).not.toBeNull();
      expect(second.read()?.bytes).toBe(first.read()?.bytes);
    });

    it('a listener made for an element that is already tapped reads at once and does not probe', async () => {
      const contexts = stubAudioContext();
      const { fetchMock } = stubFetch();
      const fake = makeMedia(BLOB_SRC);

      await create(fake.media);
      startPlaying(fake);
      fake.media.src = HTTP_SRC;

      const late = await create(fake.media);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(late.read()).not.toBeNull();
      expect(contexts[0].createMediaElementSource).toHaveBeenCalledTimes(1);
    });

    it('two elements share one context', async () => {
      const contexts = stubAudioContext();

      stubFetch();

      const a = makeMedia(BLOB_SRC);
      const b = makeMedia('data:audio/wav;base64,AAAA');

      await create(a.media);
      await create(b.media);
      startPlaying(a);
      startPlaying(b);

      expect(contexts).toHaveLength(1);
      expect(contexts[0].createMediaElementSource).toHaveBeenCalledTimes(2);
    });
  });

  describe('no Web Audio', () => {
    it('never probes, never listens to the element, reads null', async () => {
      vi.stubGlobal('AudioContext', undefined);
      vi.stubGlobal('webkitAudioContext', undefined);

      const { fetchMock } = stubFetch();
      const fake = makeMedia(HTTP_SRC);
      const listener = await create(fake.media);

      await flush();
      startPlaying(fake);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(fake.add).not.toHaveBeenCalled();
      expect(listener.read()).toBeNull();
      expect(fake.media.crossOrigin).toBeNull();
    });

    it('falls back to webkitAudioContext', async () => {
      const contexts = stubAudioContext();

      vi.stubGlobal('webkitAudioContext', globalThis.AudioContext);
      vi.stubGlobal('AudioContext', undefined);
      stubFetch();

      const fake = makeMedia(BLOB_SRC);
      const listener = await create(fake.media);

      startPlaying(fake);

      expect(contexts).toHaveLength(1);
      expect(listener.read()).not.toBeNull();
    });
  });

  describe('a tap that throws', () => {
    it('is swallowed, reads null and is not tried again', async () => {
      const contexts = stubAudioContext({ sourceThrows: true });

      stubFetch();

      const fake = makeMedia(BLOB_SRC);
      const listener = await create(fake.media);

      expect(() => startPlaying(fake)).not.toThrow();
      expect(listener.read()).toBeNull();

      startPlaying(fake);

      expect(contexts[0].createMediaElementSource).toHaveBeenCalledTimes(1);
      expect(fake.media.crossOrigin).toBeNull();
      expect(fake.load).not.toHaveBeenCalled();
      expect(listener.read()).toBeNull();
    });

    it('is swallowed when the context itself cannot be built', async () => {
      vi.stubGlobal('AudioContext', function Broken(): never {
        throw new Error('NotSupportedError');
      });
      stubFetch();

      const fake = makeMedia(BLOB_SRC);
      const listener = await create(fake.media);

      expect(() => startPlaying(fake)).not.toThrow();
      expect(listener.read()).toBeNull();
    });
  });
});
