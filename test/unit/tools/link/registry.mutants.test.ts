import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  EMBED_SERVICES,
  buildEmbedUrl,
  isHttpsUrl,
  isSamePageLink,
  resolveEmbedServiceTitle,
  setSafeLinkHref,
} from '../../../../src/tools/link/registry';

/**
 * Calls a registered service's `id`, failing loudly if that service has none —
 * the alternative is an optional call that silently asserts `undefined`.
 */
const remoteId = (service: string, groups: string[]): string => {
  const build = EMBED_SERVICES[service].id;

  if (build === undefined) {
    throw new Error(`${service} has no id()`);
  }

  return build(groups);
};

/** A groups array with real holes, which is what a non-participating capture group produces. */
const sparseGroups = (entries: Record<number, string>): string[] => {
  const groups: string[] = [];

  Object.entries(entries).forEach(([index, value]) => {
    groups[Number(index)] = value;
  });

  return groups;
};

const youtubeId = (tail: string): string => remoteId('youtube', ['VID', tail]);

/**
 * Thirteen mutants here are equivalent, and each one is a guard the code below
 * it already performs:
 *
 * - `locale === undefined` in resolveEmbedServiceTitle: with no locale,
 *   `localizedTitles?.[undefined]` is undefined and `?? title` gives the same
 *   answer, and SupportedLocale has no `undefined` key.
 * - `if (raw === undefined)` in parseYoutubeStart, and its body: `undefined`
 *   stringifies to "undefined", which matches neither the digits regex nor the
 *   anchored parts regex, so the function still returns null.
 * - `/^\d+$/` → `/\d+$/`: a raw that ends in a digit but does not start with one
 *   contains a letter, so `Number(raw)` is NaN and `start > 0` is false — and
 *   the parts regex can never match a raw ending in a digit either, because its
 *   last optional group ends in 's'. Both paths return the bare video id.
 * - The all-groups-undefined half of the parts guard: `[0-9hms]+` cannot capture
 *   an empty raw, and any non-empty raw that matches the anchored regex fills at
 *   least one group, so that half is never the reason for the return.
 * - `start !== null` in the youtube return: `null > 0` is already false.
 * - `groups[1] ?? ''` in parseYoutubeStart's caller and in the two Apple
 *   services: the replacement string contains neither `t=`/`start=` nor `i=`
 *   followed by digits, so every regex applied to it still finds nothing.
 * - `url !== undefined` in setSafeLinkHref: `isHttpUrl(undefined)` builds
 *   `new URL(undefined)`, which throws and is caught, so the href stays unset.
 * - `typeof window === 'undefined'` in isSamePageLink, its string operand and
 *   its body: without a window, falling through reads `window.location.href`
 *   inside the try, which throws into the catch and returns the same false.
 */
describe('link registry mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('resolveEmbedServiceTitle', () => {
    const service = { title: 'Google Drive', localizedTitles: { ja: 'Google ドライブ' } } as const;

    it('returns the canonical title when no locale is given', () => {
      expect(resolveEmbedServiceTitle(service)).toBe('Google Drive');
    });

    it('returns the localized title for a locale that has one', () => {
      expect(resolveEmbedServiceTitle(service, 'ja')).toBe('Google ドライブ');
    });

    it('falls back to the canonical title for a locale that has none', () => {
      expect(resolveEmbedServiceTitle(service, 'en')).toBe('Google Drive');
    });

    it('falls back to the canonical title when the service has no localized titles', () => {
      expect(resolveEmbedServiceTitle({ title: 'Vimeo' }, 'ja')).toBe('Vimeo');
    });
  });

  describe('youtube start-time parsing', () => {
    it('carries a plain seconds value into the remote id', () => {
      expect(youtubeId('?t=90')).toBe('VID?start=90');
    });

    it('adds nothing when the tail has no time parameter', () => {
      expect(youtubeId('?list=abc')).toBe('VID');
    });

    it('adds nothing for a zero start', () => {
      expect(youtubeId('?t=0')).toBe('VID');
    });

    it('reads the composite hour, minute and second form', () => {
      expect(youtubeId('?t=1h5m20s')).toBe('VID?start=3920');
    });

    it('reads an hours-only value of more than one digit', () => {
      expect(youtubeId('?t=10h')).toBe('VID?start=36000');
    });

    it('reads a minutes-only value of more than one digit', () => {
      expect(youtubeId('?t=10m')).toBe('VID?start=600');
    });

    it('reads an hours value with no seconds part', () => {
      expect(youtubeId('?t=1h')).toBe('VID?start=3600');
    });

    it('rejects a value whose parts are not anchored to the start', () => {
      expect(youtubeId('?t=h5m')).toBe('VID');
    });

    it('rejects a value with trailing junk after a valid part', () => {
      expect(youtubeId('?t=1h2h')).toBe('VID');
    });

    it('rejects a value that matches no part at all', () => {
      expect(youtubeId('?t=h')).toBe('VID');
    });

    it('accepts the start alias', () => {
      expect(youtubeId('?start=45')).toBe('VID?start=45');
    });
  });

  describe('remote ids built from capture groups', () => {
    it('appends a vimeo privacy hash only when the group matched', () => {
      expect(remoteId('vimeo', ['123', 'a1b2'])).toBe('123?h=a1b2');
      expect(remoteId('vimeo', ['123'])).toBe('123');
    });

    it('appends a rutube playlist parameter only when the group matched', () => {
      expect(remoteId('rutube', ['0'.repeat(32), 'pl1'])).toBe(`${'0'.repeat(32)}/?p=pl1`);
    });

    it('reads the vk oid, id and hash out of a video_ext query', () => {
      expect(remoteId('vkvideo', sparseGroups({ 2: 'oid=-1&id=2&hash=h9' }))).toBe('-1&id=2&hash=h9');
    });

    it('leaves the vk hash off when the query has none', () => {
      expect(remoteId('vkvideo', sparseGroups({ 2: 'oid=-1&id=2' }))).toBe('-1&id=2');
    });

    it('keeps the vk separators when the query is missing a part', () => {
      expect(remoteId('vkvideo', sparseGroups({ 2: 'id=2' }))).toBe('&id=2');
      expect(remoteId('vkvideo', sparseGroups({ 2: 'oid=-1' }))).toBe('-1&id=');
    });

    it('reads the vk oid and id out of the plain watch form', () => {
      expect(remoteId('vkvideo', ['-1', '2'])).toBe('-1&id=2');
    });

    it('carries an Our World in Data query string through', () => {
      expect(remoteId('ourworldindata', ['grapher', 'co2', '?tab=map'])).toBe('grapher/co2?tab=map');
      expect(remoteId('ourworldindata', ['grapher', 'co2'])).toBe('grapher/co2');
    });

    it('rebuilds a facebook permalink from its query', () => {
      expect(remoteId('facebookpost', sparseGroups({ 2: 'story_fbid=11&id=22' })))
        .toBe(encodeURIComponent('https://www.facebook.com/permalink.php?story_fbid=11&id=22'));
    });

    it('keeps the facebook permalink separators when a part is missing', () => {
      expect(remoteId('facebookpost', sparseGroups({ 2: 'id=22' })))
        .toBe(encodeURIComponent('https://www.facebook.com/permalink.php?story_fbid=&id=22'));
      expect(remoteId('facebookpost', sparseGroups({ 2: 'story_fbid=11' })))
        .toBe(encodeURIComponent('https://www.facebook.com/permalink.php?story_fbid=11&id='));
    });

    it('rebuilds a facebook photo link from its query', () => {
      expect(remoteId('facebookpost', sparseGroups({ 3: 'set=a.1' })))
        .toBe(encodeURIComponent('https://www.facebook.com/photo.php?fbid='));
    });

    it('adds an OpenStreetMap marker only when both coordinates matched', () => {
      expect(remoteId('openstreetmap', ['55.7', '37.6', '12', '55.75', '37.62']))
        .toBe('bbox=37.520436,55.709423,37.719564,55.790577&layer=mapnik&marker=55.7,37.6');
    });

    it('omits the OpenStreetMap marker when neither coordinate matched', () => {
      expect(remoteId('openstreetmap', sparseGroups({ 2: '12', 3: '55.75', 4: '37.62' })))
        .toBe('bbox=37.520436,55.709423,37.719564,55.790577&layer=mapnik');
    });

    it('omits the OpenStreetMap marker when only one coordinate matched', () => {
      expect(remoteId('openstreetmap', sparseGroups({ 0: '55.7', 2: '12', 3: '55.75', 4: '37.62' })))
        .toBe('bbox=37.520436,55.709423,37.719564,55.790577&layer=mapnik');
      expect(remoteId('openstreetmap', sparseGroups({ 1: '37.6', 2: '12', 3: '55.75', 4: '37.62' })))
        .toBe('bbox=37.520436,55.709423,37.719564,55.790577&layer=mapnik');
    });

    // Every id() has a fallback for a capture group the regex left out. Asserting
    // the whole map at once pins all of them: a fallback that changes shows up as
    // one changed entry.
    it('degrades to a defined string for every service when nothing was captured', () => {
      const empty: Record<string, string> = {};

      Object.entries(EMBED_SERVICES).forEach(([key, service]) => {
        if (service.id !== undefined) {
          empty[key] = service.id([]);
        }
      });

      expect(empty).toStrictEqual({
        youtube: '',
        vimeo: '',
        rutube: '',
        vkvideo: '&id=',
        codepen: 'undefined/embed/undefined',
        figma: 'undefined/undefined',
        spotify: 'undefined/undefined',
        googledrive: '',
        googlesheets: 'undefined/preview',
        drawio: '?lightbox=1&nav=1#undefinedundefined',
        bilibili: 'aid=undefined&autoplay=0',
        youku: '',
        yandexmusic: 'playlist/undefined/undefined',
        arte: 'undefined/undefined',
        deezer: 'undefined/undefined',
        soundcloud: 'https%3A%2F%2Fsoundcloud.com%2Fundefined%2Fundefined',
        mixcloud: 'https%3A%2F%2Fwww.mixcloud.com%2Fundefined%2Fundefined%2F',
        applemusic: '',
        applepodcasts: '',
        audiomack: 'undefined/undefined/undefined',
        anghami: 'undefined/undefined',
        giphy: '',
        stackblitz: 'undefined?embed=1',
        typeform: 'undefined.typeform.com/to/undefined',
        airtable: '',
        miro: '',
        facebookvideo: 'https%3A%2F%2Fwww.facebook.com%2Fundefined%2Fvideos%2Fundefined%2F',
        facebookpost: 'https%3A%2F%2Fwww.facebook.com%2Fundefined%2Fposts%2Fundefined',
        linkedin: 'undefined:undefined',
        mastodon: 'undefined/undefined/undefined',
        substack: 'undefined.substack.com/embed/p/undefined',
        peertube: 'undefined/videos/embed/undefined',
        odysee: '',
        tidal: 'undefineds/undefined',
        spotifypodcasters: 'undefined/embed/episodes/undefined',
        acast: 'undefined/undefined',
        podbean: 'undefined-undefined-pb',
        castbox: 'idundefined/idundefined',
        hearthis: 'undefined/undefined',
        calendly: '',
        excalidraw: 'undefined,undefined',
        tldraw: 'undefined/undefined',
        chromatic: 'undefined.chromatic.com/iframe.html?id=undefined&viewMode=story',
        datawrapper: '',
        flourish: 'undefined/undefined',
        ourworldindata: 'undefined/undefined',
        geogebra: 'undefined/undefined',
        arcgisstorymaps: 'undefined/undefined',
        p5js: 'undefined/full/undefined',
        sketchfab: '',
        openstreetmap: 'bbox=-180.000000,-85.000000,180.000000,85.000000&layer=mapnik',
        tencentvideo: '',
        mailru: 'undefined/undefined/video/embed/undefined/undefined',
        telegram: 'undefined/undefined',
        threads: 'undefined/post/undefined',
      });
    });
  });

  describe('buildEmbedUrl', () => {
    it('substitutes the remote id into the template', () => {
      expect(buildEmbedUrl('youtube', 'abc')).toBe('https://www.youtube.com/embed/abc');
    });

    it('names the unknown service in the error', () => {
      expect(() => buildEmbedUrl('nope', 'abc')).toThrow('Unknown embed service: nope');
    });
  });

  describe('isHttpsUrl', () => {
    it('accepts https', () => {
      expect(isHttpsUrl('https://a.test/x')).toBe(true);
    });

    it('rejects http', () => {
      expect(isHttpsUrl('http://a.test/x')).toBe(false);
    });

    it('rejects a value that is not a URL', () => {
      expect(isHttpsUrl('not a url')).toBe(false);
    });
  });

  describe('setSafeLinkHref', () => {
    it('sets the href for a safe absolute URL', () => {
      const anchor = document.createElement('a');

      setSafeLinkHref(anchor, 'https://a.test/x');

      expect(anchor.getAttribute('href')).toBe('https://a.test/x');
    });

    it('leaves the anchor without an href for a script URL', () => {
      const anchor = document.createElement('a');

      setSafeLinkHref(anchor, 'javascript:alert(1)');

      expect(anchor.hasAttribute('href')).toBe(false);
    });

    it('leaves the anchor without an href when there is no URL', () => {
      const anchor = document.createElement('a');

      setSafeLinkHref(anchor, undefined);

      expect(anchor.hasAttribute('href')).toBe(false);
    });
  });

  describe('isSamePageLink', () => {
    it('accepts a bare fragment', () => {
      expect(isSamePageLink('#results')).toBe(true);
    });

    it('accepts a URL that resolves to the current page', () => {
      expect(isSamePageLink(window.location.href)).toBe(true);
    });

    it('rejects another origin', () => {
      expect(isSamePageLink('https://other.test/')).toBe(false);
    });

    it('rejects another path on the same origin', () => {
      expect(isSamePageLink('/somewhere-else')).toBe(false);
    });

    it('rejects a value the URL parser cannot resolve', () => {
      expect(isSamePageLink('http://[')).toBe(false);
    });

    // Without a window the fragment test is the only thing that can answer, so
    // this is the one environment where the two branches are distinguishable.
    it('still accepts a fragment with no window, and rejects everything else', () => {
      vi.stubGlobal('window', undefined);

      expect(isSamePageLink('  #results')).toBe(true);
      expect(isSamePageLink('/somewhere-else')).toBe(false);
    });
  });
});
