import { describe, it, expect } from 'vitest';
import {
  matchEmbedService,
  buildEmbedUrl,
  isHttpUrl,
} from '../../../../src/tools/link/registry';

describe('link registry', () => {
  describe('matchEmbedService', () => {
    it('matches a YouTube watch URL and extracts the video id', () => {
      const result = matchEmbedService('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

      expect(result).not.toBeNull();
      expect(result?.service).toBe('youtube');
      expect(result?.remoteId).toBe('dQw4w9WgXcQ');
    });

    it('matches a youtu.be short URL', () => {
      const result = matchEmbedService('https://youtu.be/dQw4w9WgXcQ');

      expect(result?.service).toBe('youtube');
      expect(result?.remoteId).toBe('dQw4w9WgXcQ');
    });

    it('matches a Vimeo URL and extracts the numeric id', () => {
      const result = matchEmbedService('https://vimeo.com/123456789');

      expect(result?.service).toBe('vimeo');
      expect(result?.remoteId).toBe('123456789');
    });

    it('matches a Rutube URL', () => {
      const result = matchEmbedService('https://rutube.ru/video/abcdef0123456789abcdef0123456789/');

      expect(result?.service).toBe('rutube');
      expect(result?.remoteId).toBe('abcdef0123456789abcdef0123456789');
    });

    it('matches a VKVideo URL and combines owner + video id', () => {
      const result = matchEmbedService('https://vk.com/video-12345_67890');

      expect(result?.service).toBe('vkvideo');
      expect(result?.remoteId).toBe('-12345&id=67890');
    });

    it('matches a CodePen URL and rewrites the path to the embed form', () => {
      const result = matchEmbedService('https://codepen.io/team/pen/AbCdEf');

      expect(result?.service).toBe('codepen');
      expect(result?.embedUrl).toBe('https://codepen.io/team/embed/AbCdEf?default-tab=result');
    });

    it('matches a Loom share URL', () => {
      const result = matchEmbedService('https://www.loom.com/share/abc123');

      expect(result?.service).toBe('loom');
      expect(result?.embedUrl).toBe('https://www.loom.com/embed/abc123');
    });

    it('matches a Figma design URL using the embed.figma.com host', () => {
      const result = matchEmbedService('https://www.figma.com/design/KEY123/My-File');

      expect(result?.service).toBe('figma');
      expect(result?.embedUrl).toBe('https://embed.figma.com/design/KEY123?embed-host=blok');
    });

    it('matches a Spotify track URL', () => {
      const result = matchEmbedService('https://open.spotify.com/track/ID456?si=x');

      expect(result?.service).toBe('spotify');
      expect(result?.embedUrl).toBe('https://open.spotify.com/embed/track/ID456');
    });

    it('matches a Google Drive file URL and points at the preview', () => {
      const result = matchEmbedService('https://drive.google.com/file/d/FILEID/view?usp=sharing');

      expect(result?.service).toBe('googledrive');
      expect(result?.embedUrl).toBe('https://drive.google.com/file/d/FILEID/preview');
    });

    it('flags Twitter/X as a script embed', () => {
      const result = matchEmbedService('https://x.com/user/status/1234567890');

      expect(result?.service).toBe('twitter');
      expect(result?.remoteId).toBe('1234567890');
      expect(result?.kind).toBe('script');
    });

    it('flags Telegram as a script embed and keeps channel/post id', () => {
      const result = matchEmbedService('https://t.me/durov/123');

      expect(result?.service).toBe('telegram');
      expect(result?.remoteId).toBe('durov/123');
      expect(result?.kind).toBe('script');
    });

    it('defaults known iframe providers to kind "iframe"', () => {
      expect(matchEmbedService('https://youtu.be/dQw4w9WgXcQ')?.kind).toBe('iframe');
    });

    it('returns null for a generic non-provider URL', () => {
      expect(matchEmbedService('https://example.com/some/article')).toBeNull();
    });

    it('returns null for a non-URL string', () => {
      expect(matchEmbedService('not a url')).toBeNull();
    });
  });

  describe('buildEmbedUrl', () => {
    it('substitutes the remote id into the YouTube embed template', () => {
      expect(buildEmbedUrl('youtube', 'dQw4w9WgXcQ')).toBe(
        'https://www.youtube.com/embed/dQw4w9WgXcQ'
      );
    });

    it('substitutes a pre-combined remote id into the VKVideo template', () => {
      expect(buildEmbedUrl('vkvideo', '-12345&id=67890')).toBe(
        'https://vk.com/video_ext.php?oid=-12345&id=67890'
      );
    });

    it('throws for an unknown service', () => {
      expect(() => buildEmbedUrl('nope', 'x')).toThrow();
    });
  });

  describe('isHttpUrl', () => {
    it('accepts http and https URLs', () => {
      expect(isHttpUrl('http://example.com')).toBe(true);
      expect(isHttpUrl('https://example.com/path?q=1')).toBe(true);
    });

    it('rejects javascript:, data:, and ftp: schemes', () => {
      expect(isHttpUrl('javascript:alert(1)')).toBe(false);
      expect(isHttpUrl('data:text/html,<script>1</script>')).toBe(false);
      expect(isHttpUrl('ftp://example.com/file')).toBe(false);
    });

    it('rejects a non-URL string', () => {
      expect(isHttpUrl('just text')).toBe(false);
    });
  });
});
