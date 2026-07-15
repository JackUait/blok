import { describe, it, expect } from 'vitest';
import { normalizeAudioShareLink } from '../../../../src/tools/audio/share-links';

const DRIVE_ID = '1kEpLxTdbrbEFMCUNSIrMkxCixC20ELrM';
const DRIVE_DIRECT = `https://drive.usercontent.google.com/download?id=${DRIVE_ID}&export=download&confirm=t`;

describe('normalizeAudioShareLink', () => {
  describe('google drive (proxy required)', () => {
    it('normalizes a /file/d/<id>/view share link', () => {
      expect(normalizeAudioShareLink(`https://drive.google.com/file/d/${DRIVE_ID}/view?usp=drive_link`))
        .toEqual({ url: DRIVE_DIRECT, service: 'google-drive', requiresProxy: true });
    });

    it('normalizes a /file/d/<id> link without a /view suffix', () => {
      expect(normalizeAudioShareLink(`https://drive.google.com/file/d/${DRIVE_ID}`)?.url).toBe(DRIVE_DIRECT);
    });

    it('normalizes an open?id=<id> link', () => {
      expect(normalizeAudioShareLink(`https://drive.google.com/open?id=${DRIVE_ID}`)?.url).toBe(DRIVE_DIRECT);
    });

    it('returns null for Drive folder links', () => {
      expect(normalizeAudioShareLink(`https://drive.google.com/drive/folders/${DRIVE_ID}`)).toBeNull();
    });

    it('returns null for a lookalike host', () => {
      expect(normalizeAudioShareLink(`https://drive.google.com.evil.example/file/d/${DRIVE_ID}/view`)).toBeNull();
    });
  });

  describe('dropbox (direct)', () => {
    it('rewrites a legacy /s/ share link to the direct-content host', () => {
      expect(normalizeAudioShareLink('https://www.dropbox.com/s/abc123/song.mp3?dl=0'))
        .toEqual({ url: 'https://dl.dropboxusercontent.com/s/abc123/song.mp3', service: 'dropbox', requiresProxy: false });
    });

    it('rewrites a /scl/fi/ share link keeping rlkey but dropping dl', () => {
      expect(normalizeAudioShareLink('https://www.dropbox.com/scl/fi/abc123/song.mp3?rlkey=k1&st=s1&dl=0')?.url)
        .toBe('https://dl.dropboxusercontent.com/scl/fi/abc123/song.mp3?rlkey=k1&st=s1');
    });

    it('accepts the bare dropbox.com host', () => {
      expect(normalizeAudioShareLink('https://dropbox.com/s/abc123/song.mp3')?.url)
        .toBe('https://dl.dropboxusercontent.com/s/abc123/song.mp3');
    });

    it('returns null for non-share dropbox pages', () => {
      expect(normalizeAudioShareLink('https://www.dropbox.com/home/Music')).toBeNull();
    });
  });

  describe('onedrive (direct)', () => {
    it('wraps a 1drv.ms short link in the shares API content URL', () => {
      const raw = 'https://1drv.ms/u/s!AkY3x0examp1e';
      const result = normalizeAudioShareLink(raw);

      expect(result?.service).toBe('onedrive');
      expect(result?.requiresProxy).toBe(false);
      expect(result?.url).toMatch(/^https:\/\/api\.onedrive\.com\/v1\.0\/shares\/u!/);
      expect(result?.url).toMatch(/\/root\/content$/);
      // base64url alphabet only (no +, /, or padding)
      const token = /shares\/u!([^/]+)\//.exec(result?.url ?? '')?.[1];

      expect(token).toBeTruthy();
      expect(token).not.toMatch(/[+/=]/);
    });

    it('wraps an onedrive.live.com link too', () => {
      expect(normalizeAudioShareLink('https://onedrive.live.com/?cid=ABC&id=ABC%21123&authkey=%21AAA')?.service)
        .toBe('onedrive');
    });
  });

  describe('github (direct)', () => {
    it('rewrites a blob URL to raw.githubusercontent.com', () => {
      expect(normalizeAudioShareLink('https://github.com/user/repo/blob/main/audio/song.mp3'))
        .toEqual({ url: 'https://raw.githubusercontent.com/user/repo/main/audio/song.mp3', service: 'github', requiresProxy: false });
    });

    it('rewrites a /raw/ URL to raw.githubusercontent.com', () => {
      expect(normalizeAudioShareLink('https://github.com/user/repo/raw/main/song.mp3')?.url)
        .toBe('https://raw.githubusercontent.com/user/repo/main/song.mp3');
    });

    it('returns null for repo pages without a file path', () => {
      expect(normalizeAudioShareLink('https://github.com/user/repo')).toBeNull();
    });
  });

  describe('gitlab (direct)', () => {
    it('rewrites /-/blob/ to /-/raw/', () => {
      expect(normalizeAudioShareLink('https://gitlab.com/group/project/-/blob/main/song.mp3'))
        .toEqual({ url: 'https://gitlab.com/group/project/-/raw/main/song.mp3', service: 'gitlab', requiresProxy: false });
    });

    it('handles nested groups', () => {
      expect(normalizeAudioShareLink('https://gitlab.com/a/b/c/-/blob/main/dir/song.ogg')?.url)
        .toBe('https://gitlab.com/a/b/c/-/raw/main/dir/song.ogg');
    });
  });

  describe('hugging face (direct)', () => {
    it('rewrites /blob/ to /resolve/', () => {
      expect(normalizeAudioShareLink('https://huggingface.co/org/model/blob/main/sample.wav'))
        .toEqual({ url: 'https://huggingface.co/org/model/resolve/main/sample.wav', service: 'huggingface', requiresProxy: false });
    });

    it('handles dataset URLs', () => {
      expect(normalizeAudioShareLink('https://huggingface.co/datasets/org/ds/blob/main/clip.flac')?.url)
        .toBe('https://huggingface.co/datasets/org/ds/resolve/main/clip.flac');
    });
  });

  describe('google cloud storage (direct)', () => {
    it('rewrites the authenticated browser host to the public API host', () => {
      expect(normalizeAudioShareLink('https://storage.cloud.google.com/bucket/dir/song.mp3'))
        .toEqual({ url: 'https://storage.googleapis.com/bucket/dir/song.mp3', service: 'gcs', requiresProxy: false });
    });
  });

  describe('internet archive (direct)', () => {
    it('rewrites a /details/ file page to /download/', () => {
      expect(normalizeAudioShareLink('https://archive.org/details/item-id/track01.mp3'))
        .toEqual({ url: 'https://archive.org/download/item-id/track01.mp3', service: 'internet-archive', requiresProxy: false });
    });

    it('returns null for a bare item page without a file path', () => {
      expect(normalizeAudioShareLink('https://archive.org/details/item-id')).toBeNull();
    });
  });

  describe('non-share URLs', () => {
    it('returns null for a plain direct URL', () => {
      expect(normalizeAudioShareLink('https://example.com/song.mp3')).toBeNull();
    });

    it('returns null for unparseable input', () => {
      expect(normalizeAudioShareLink('not a url')).toBeNull();
    });
  });
});
