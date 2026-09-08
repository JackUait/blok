import { describe, it, expect } from 'vitest';

import { normalizeAudioShareLink } from '../../../../src/tools/audio/share-links';

const DRIVE_DIRECT = 'https://drive.usercontent.google.com/download?id=ABC123&export=download&confirm=t';

/**
 * One survivor is equivalent: dropping the end anchor from the padding pattern.
 * Base64 uses `=` only as padding, so the string can hold at most one run of
 * them and it is always the last thing in it — the first match and the anchored
 * match are the same match.
 */
describe('audio share link mutants', () => {
  it('refuses input that is not a URL at all', () => {
    expect(normalizeAudioShareLink('not a url')).toBeNull();
  });

  describe('Google Drive', () => {
    it('reads the id from a file path and from an open link', () => {
      expect(normalizeAudioShareLink('https://drive.google.com/file/d/ABC123/view')).toStrictEqual({
        url: DRIVE_DIRECT,
        service: 'google-drive',
        requiresProxy: true,
      });
      expect(normalizeAudioShareLink('https://drive.google.com/open?id=ABC123')?.url).toBe(DRIVE_DIRECT);
    });

    // Only /open carries the id in the query; any other path with one is a
    // page, not a file reference.
    it('ignores a query id on a path that is not open', () => {
      expect(normalizeAudioShareLink('https://drive.google.com/uc?id=ABC123')).toBeNull();
    });
  });

  describe('Dropbox', () => {
    it('moves a share path onto the download host and drops the dl flag', () => {
      expect(normalizeAudioShareLink('https://www.dropbox.com/s/abc/song.mp3?dl=0')).toStrictEqual({
        url: 'https://dl.dropboxusercontent.com/s/abc/song.mp3',
        service: 'dropbox',
        requiresProxy: false,
      });
    });

    it('does not claim a foreign host carrying a dropbox-shaped path', () => {
      expect(normalizeAudioShareLink('https://example.com/s/abc/song.mp3')).toBeNull();
    });
  });

  describe('OneDrive', () => {
    // btoa emits + and / for these bytes; both are illegal in the base64url
    // token the shares API expects.
    it('encodes the share URL as base64url', () => {
      expect(normalizeAudioShareLink('https://1drv.ms/u/s!~aa?')?.url)
        .toBe('https://api.onedrive.com/v1.0/shares/u!aHR0cHM6Ly8xZHJ2Lm1zL3UvcyF-YWE_/root/content');
    });

    // This one encodes to two padding characters, so stripping a single one
    // would leave the token invalid.
    it('strips the whole padding run', () => {
      expect(normalizeAudioShareLink('https://1drv.ms/u/c/0123456789abcdef/EQ?e=z')?.url)
        .toBe('https://api.onedrive.com/v1.0/shares/'
          + 'u!aHR0cHM6Ly8xZHJ2Lm1zL3UvYy8wMTIzNDU2Nzg5YWJjZGVmL0VRP2U9eg/root/content');
    });
  });

  describe('GitHub', () => {
    it('rewrites a blob path to raw content, keeping the rest of the path', () => {
      expect(normalizeAudioShareLink('https://github.com/o/r/blob/main/dir/song.mp3')).toStrictEqual({
        url: 'https://raw.githubusercontent.com/o/r/main/dir/song.mp3',
        service: 'github',
        requiresProxy: false,
      });
    });

    it('refuses a path too short to name a file, and one that is not a blob', () => {
      expect(normalizeAudioShareLink('https://github.com/o/r/blob/song.mp3')).toBeNull();
      expect(normalizeAudioShareLink('https://github.com/o/r/tree/main/song.mp3')).toBeNull();
    });
  });

  describe('GitLab', () => {
    it('rewrites a blob path to raw', () => {
      expect(normalizeAudioShareLink('https://gitlab.com/o/r/-/blob/main/song.mp3')).toStrictEqual({
        url: 'https://gitlab.com/o/r/-/raw/main/song.mp3',
        service: 'gitlab',
        requiresProxy: false,
      });
    });

    it('refuses the host without the path, and the path without the host', () => {
      expect(normalizeAudioShareLink('https://gitlab.com/o/r')).toBeNull();
      expect(normalizeAudioShareLink('https://example.com/o/r/-/blob/main/song.mp3')).toBeNull();
    });
  });

  describe('Hugging Face', () => {
    it('rewrites a blob path to resolve', () => {
      expect(normalizeAudioShareLink('https://huggingface.co/o/m/blob/main/song.mp3')).toStrictEqual({
        url: 'https://huggingface.co/o/m/resolve/main/song.mp3',
        service: 'huggingface',
        requiresProxy: false,
      });
    });

    it('refuses the host without the path, and the path without the host', () => {
      expect(normalizeAudioShareLink('https://huggingface.co/o/m')).toBeNull();
      expect(normalizeAudioShareLink('https://example.com/o/m/blob/main/song.mp3')).toBeNull();
    });
  });

  describe('Internet Archive', () => {
    it('turns a details page into a download path, on either host', () => {
      expect(normalizeAudioShareLink('https://archive.org/details/item/song.mp3')).toStrictEqual({
        url: 'https://archive.org/download/item/song.mp3',
        service: 'internet-archive',
        requiresProxy: false,
      });
      expect(normalizeAudioShareLink('https://www.archive.org/details/item/song.mp3')?.url)
        .toBe('https://archive.org/download/item/song.mp3');
    });

    it('refuses a path that is not a details page, and a foreign host', () => {
      expect(normalizeAudioShareLink('https://archive.org/download/item/song.mp3')).toBeNull();
      expect(normalizeAudioShareLink('https://example.com/details/item/song.mp3')).toBeNull();
    });
  });
});
