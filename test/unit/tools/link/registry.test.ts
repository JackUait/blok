import { describe, it, expect } from 'vitest';
import {
  matchEmbedService,
  buildEmbedUrl,
  isHttpUrl,
  EMBED_SERVICES,
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
      const result = matchEmbedService('https://www.loom.com/share/e5b8c04bca094dd8a5507925ab887002');

      expect(result?.service).toBe('loom');
      expect(result?.embedUrl).toBe('https://www.loom.com/embed/e5b8c04bca094dd8a5507925ab887002');
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

  describe('YouTube URL variants', () => {
    it('matches a Shorts share link and embeds the video', () => {
      const result = matchEmbedService('https://www.youtube.com/shorts/aqz-KE-bpKQ?si=XyZ');

      expect(result?.service).toBe('youtube');
      expect(result?.embedUrl).toBe('https://www.youtube.com/embed/aqz-KE-bpKQ');
    });

    it('matches a live-stream share link (youtube.com/live/ID)', () => {
      const result = matchEmbedService('https://www.youtube.com/live/jfKfPfyJRdk?si=AbC');

      expect(result?.service).toBe('youtube');
      expect(result?.embedUrl).toBe('https://www.youtube.com/embed/jfKfPfyJRdk');
    });

    it('carries a youtu.be ?t= timestamp into the embed start param', () => {
      const result = matchEmbedService('https://youtu.be/dQw4w9WgXcQ?t=43');

      expect(result?.embedUrl).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ?start=43');
    });

    it('converts a watch URL &t=43s timestamp to seconds', () => {
      const result = matchEmbedService('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=43s');

      expect(result?.embedUrl).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ?start=43');
    });

    it('converts an h/m/s composite timestamp to seconds', () => {
      const result = matchEmbedService('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1h5m20s');

      expect(result?.embedUrl).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ?start=3920');
    });

    it('matches a playlist page URL via the videoseries embed', () => {
      const result = matchEmbedService('https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf');

      expect(result?.service).toBe('youtubeplaylist');
      expect(result?.embedUrl).toBe('https://www.youtube.com/embed/videoseries?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf');
    });

    it('matches a YouTube Music album/playlist share link', () => {
      const result = matchEmbedService('https://music.youtube.com/playlist?list=OLAK5uy_kEeXdAS3MSRKbK3rx2GWhVjL-rtYpHhrk');

      expect(result?.service).toBe('youtubeplaylist');
      expect(result?.embedUrl).toBe('https://www.youtube.com/embed/videoseries?list=OLAK5uy_kEeXdAS3MSRKbK3rx2GWhVjL-rtYpHhrk');
    });

    it('matches mobile and music watch URLs', () => {
      expect(matchEmbedService('https://m.youtube.com/watch?v=dQw4w9WgXcQ')?.service).toBe('youtube');
      expect(matchEmbedService('https://music.youtube.com/watch?v=dQw4w9WgXcQ')?.service).toBe('youtube');
    });

    it('matches a privacy-enhanced youtube-nocookie embed URL', () => {
      const result = matchEmbedService('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');

      expect(result?.embedUrl).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
    });

    it('does not match a youtube pattern inside a foreign URL', () => {
      expect(matchEmbedService('https://example.com/blog/youtu.be/notavideo')).toBeNull();
      expect(matchEmbedService('https://yyoutube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    });
  });

  describe('Vimeo URL variants', () => {
    it('matches an unlisted private link and carries the hash', () => {
      const result = matchEmbedService('https://vimeo.com/800138810/fdcc90d662?share=copy');

      expect(result?.service).toBe('vimeo');
      expect(result?.embedUrl).toBe('https://player.vimeo.com/video/800138810?h=fdcc90d662');
    });

    it('matches a groups video URL', () => {
      const result = matchEmbedService('https://vimeo.com/groups/motion/videos/1191932918');

      expect(result?.embedUrl).toBe('https://player.vimeo.com/video/1191932918');
    });

    it('matches a showcase per-video URL', () => {
      const result = matchEmbedService('https://vimeo.com/showcase/7008490/video/407943692');

      expect(result?.embedUrl).toBe('https://player.vimeo.com/video/407943692');
    });

    it('matches a whole-showcase link via the showcase embed', () => {
      const result = matchEmbedService('https://vimeo.com/showcase/7008490');

      expect(result?.service).toBe('vimeoshowcase');
      expect(result?.embedUrl).toBe('https://vimeo.com/showcase/7008490/embed');
    });

    it('matches a player.vimeo.com URL copied from embed code', () => {
      const result = matchEmbedService('https://player.vimeo.com/video/76979871');

      expect(result?.embedUrl).toBe('https://player.vimeo.com/video/76979871');
    });

    it('matches an event/live link via the event embed', () => {
      const result = matchEmbedService('https://vimeo.com/event/5285353');

      expect(result?.service).toBe('vimeoevent');
      expect(result?.embedUrl).toBe('https://vimeo.com/event/5285353/embed');
    });

    it('does not match a vimeo pattern inside a foreign URL', () => {
      expect(matchEmbedService('https://notvimeo.com/123456789')).toBeNull();
      expect(matchEmbedService('https://example.com/vimeo.com/123456789')).toBeNull();
    });
  });

  describe('Rutube URL variants', () => {
    it('matches a private video link and carries the access key', () => {
      const result = matchEmbedService('https://rutube.ru/video/private/0a1b2c3d4e5f60718293a4b5c6d7e8f9/?p=abCdEfGhIjKlMnOp');

      expect(result?.service).toBe('rutube');
      expect(result?.embedUrl).toBe('https://rutube.ru/play/embed/0a1b2c3d4e5f60718293a4b5c6d7e8f9/?p=abCdEfGhIjKlMnOp');
    });

    it('matches a shorts link', () => {
      const result = matchEmbedService('https://rutube.ru/shorts/e6f1b13524c13755897a03b850b44d81/');

      expect(result?.embedUrl).toBe('https://rutube.ru/play/embed/e6f1b13524c13755897a03b850b44d81');
    });

    it('matches a live stream page', () => {
      const result = matchEmbedService('https://rutube.ru/live/video/9ae8e8a6dc58bdad66190475f9872ecd/');

      expect(result?.embedUrl).toBe('https://rutube.ru/play/embed/9ae8e8a6dc58bdad66190475f9872ecd');
    });

    it('matches a direct play/embed link', () => {
      const result = matchEmbedService('https://rutube.ru/play/embed/a10e53b86e8f349080f718582ce4c661');

      expect(result?.embedUrl).toBe('https://rutube.ru/play/embed/a10e53b86e8f349080f718582ce4c661');
    });

    it('does not match category or person listing pages', () => {
      expect(matchEmbedService('https://rutube.ru/video/category/13/')).toBeNull();
      expect(matchEmbedService('https://rutube.ru/video/person/123/')).toBeNull();
    });
  });

  describe('VK video URL variants', () => {
    it('matches the vkvideo.ru canonical domain', () => {
      const result = matchEmbedService('https://vkvideo.ru/video-127553155_456242961');

      expect(result?.service).toBe('vkvideo');
      expect(result?.embedUrl).toBe('https://vk.com/video_ext.php?oid=-127553155&id=456242961');
    });

    it('matches mobile and sport subdomains of vkvideo.ru', () => {
      expect(matchEmbedService('https://m.vkvideo.ru/video-127553155_456242961')?.service).toBe('vkvideo');
      expect(matchEmbedService('https://vksport.vkvideo.ru/video-127553155_456242961')?.service).toBe('vkvideo');
    });

    it('matches the vk.ru mirror domain', () => {
      expect(matchEmbedService('https://vk.ru/video-111111111_456239017')?.service).toBe('vkvideo');
    });

    it('passes through an official video_ext.php iframe src with its hash', () => {
      const result = matchEmbedService('https://vk.com/video_ext.php?oid=-169900104&id=456239405&hash=abcdef123456');

      expect(result?.embedUrl).toBe('https://vk.com/video_ext.php?oid=-169900104&id=456239405&hash=abcdef123456');
    });

    it('matches VK Clips links', () => {
      const result = matchEmbedService('https://vkvideo.ru/clip-26006257_456242116');

      expect(result?.embedUrl).toBe('https://vk.com/video_ext.php?oid=-26006257&id=456242116');
    });

    it('extracts the video from a modal/overlay ?z= URL', () => {
      const result = matchEmbedService('https://vk.com/video-77521?z=video-77521_162222515%2Fclub77521');

      expect(result?.embedUrl).toBe('https://vk.com/video_ext.php?oid=-77521&id=162222515');
    });

    it('does not match a lookalike host', () => {
      expect(matchEmbedService('https://notvk.com/video-1_2')).toBeNull();
    });
  });

  describe('CodePen URL variants', () => {
    it('matches a CodePen 2.0 editor pen URL', () => {
      const result = matchEmbedService('https://codepen.io/editor/chriscoyier/pen/0193dae5-fa74-77ba-8827-86f3b88a5c69');

      expect(result?.embedUrl).toBe('https://codepen.io/editor/chriscoyier/embed/0193dae5-fa74-77ba-8827-86f3b88a5c69?default-tab=result');
    });

    it('keeps the access token of a private pen URL', () => {
      const result = matchEmbedService('https://codepen.io/chriscoyier/pen/dyxrZxx/129ec4022765b66efb1c8730e5662bb0');

      expect(result?.embedUrl).toBe('https://codepen.io/chriscoyier/embed/dyxrZxx/129ec4022765b66efb1c8730e5662bb0?default-tab=result');
    });

    it('matches a team pen URL', () => {
      const result = matchEmbedService('https://codepen.io/team/codepen/pen/EVdVpQ');

      expect(result?.embedUrl).toBe('https://codepen.io/team/codepen/embed/EVdVpQ?default-tab=result');
    });

    it('matches full, details and debug views', () => {
      expect(matchEmbedService('https://codepen.io/chriscoyier/full/BaPLzGq')?.embedUrl)
        .toBe('https://codepen.io/chriscoyier/embed/BaPLzGq?default-tab=result');
      expect(matchEmbedService('https://codepen.io/chriscoyier/details/jOeBzNN')?.embedUrl)
        .toBe('https://codepen.io/chriscoyier/embed/jOeBzNN?default-tab=result');
      expect(matchEmbedService('https://codepen.io/chriscoyier/debug/egJaoR')?.embedUrl)
        .toBe('https://codepen.io/chriscoyier/embed/egJaoR?default-tab=result');
    });

    it('does not match collection or profile URLs', () => {
      expect(matchEmbedService('https://codepen.io/collection/XKgNqN')).toBeNull();
      expect(matchEmbedService('https://codepen.io/chriscoyier')).toBeNull();
    });
  });

  describe('Loom URL variants', () => {
    it('matches a direct embed URL and strips the sid param', () => {
      const result = matchEmbedService('https://www.loom.com/embed/e5b8c04bca094dd8a5507925ab887002?sid=0f136068-cf47-494a-9057-b1b07f973cea');

      expect(result?.embedUrl).toBe('https://www.loom.com/embed/e5b8c04bca094dd8a5507925ab887002');
    });

    it('does not match a folder share link (not embeddable)', () => {
      expect(matchEmbedService('https://www.loom.com/share/folder/0cfe19ca67f04cdea997249b9028fc40')).toBeNull();
    });
  });

  describe('Figma URL variants', () => {
    it('matches a Figma Slides editor link', () => {
      const result = matchEmbedService('https://www.figma.com/slides/Ab1Cd2Ef3Gh4Ij5Kl6Mn7O/Q3-Review?node-id=1-2');

      expect(result?.service).toBe('figma');
      expect(result?.embedUrl).toBe('https://embed.figma.com/slides/Ab1Cd2Ef3Gh4Ij5Kl6Mn7O?embed-host=blok');
    });

    it('matches a deck (share-for-presenting) link', () => {
      const result = matchEmbedService('https://www.figma.com/deck/Ab1Cd2Ef3Gh4Ij5Kl6Mn7O/Q3-Review');

      expect(result?.embedUrl).toBe('https://embed.figma.com/deck/Ab1Cd2Ef3Gh4Ij5Kl6Mn7O?embed-host=blok');
    });
  });

  describe('Spotify URL variants', () => {
    it('matches an intl locale-prefixed URL', () => {
      const result = matchEmbedService('https://open.spotify.com/intl-de/track/4cOdK2wGLETKBW3PvgPWqT?si=abc');

      expect(result?.service).toBe('spotify');
      expect(result?.embedUrl).toBe('https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT');
    });

    it('matches a bare embed URL copied from the embed snippet', () => {
      const result = matchEmbedService('https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT');

      expect(result?.embedUrl).toBe('https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT');
    });

    it('does not match non-embeddable spotify pages', () => {
      expect(matchEmbedService('https://open.spotify.com/concert/2yMmJZ8q')).toBeNull();
      expect(matchEmbedService('https://open.spotify.com/user/spotify')).toBeNull();
    });
  });

  describe('Google Drive and Docs URL variants', () => {
    it('matches a multi-account /file/u/N/d/ URL', () => {
      const result = matchEmbedService('https://drive.google.com/file/u/1/d/1A2b3C4d5E6f7G8h9I0jKLMNOPqrstuv/view');

      expect(result?.service).toBe('googledrive');
      expect(result?.embedUrl).toBe('https://drive.google.com/file/d/1A2b3C4d5E6f7G8h9I0jKLMNOPqrstuv/preview');
    });

    it('matches a legacy open?id= link', () => {
      const result = matchEmbedService('https://drive.google.com/open?id=1A2b3C4d5E6f7G8h9I0jKLMNOPqrstuv');

      expect(result?.embedUrl).toBe('https://drive.google.com/file/d/1A2b3C4d5E6f7G8h9I0jKLMNOPqrstuv/preview');
    });

    it('matches a folder share link via the embedded folder view', () => {
      const result = matchEmbedService('https://drive.google.com/drive/folders/1A2b3C4d5E6f7G8h9I0jKLMNOPqrstuv?usp=sharing');

      expect(result?.service).toBe('googledrivefolder');
      expect(result?.embedUrl).toBe('https://drive.google.com/embeddedfolderview?id=1A2b3C4d5E6f7G8h9I0jKLMNOPqrstuv#list');
    });

    it('matches a Google Docs document share link', () => {
      const result = matchEmbedService('https://docs.google.com/document/d/1A2b3C4d5E6f7G8h9I0jKLMNOPqrstuv/edit?usp=sharing');

      expect(result?.service).toBe('googledocs');
      expect(result?.embedUrl).toBe('https://docs.google.com/document/d/1A2b3C4d5E6f7G8h9I0jKLMNOPqrstuv/preview');
    });

    it('matches a Google Sheets share link', () => {
      const result = matchEmbedService('https://docs.google.com/spreadsheets/d/1A2b3C4d5E6f7G8h9I0jKLMNOPqrstuv/edit?gid=0#gid=0');

      expect(result?.service).toBe('googlesheets');
      expect(result?.embedUrl).toBe('https://docs.google.com/spreadsheets/d/1A2b3C4d5E6f7G8h9I0jKLMNOPqrstuv/preview');
    });

    it('matches a Google Slides share link', () => {
      const result = matchEmbedService('https://docs.google.com/presentation/d/1A2b3C4d5E6f7G8h9I0jKLMNOPqrstuv/edit?usp=sharing');

      expect(result?.service).toBe('googleslides');
      expect(result?.embedUrl).toBe('https://docs.google.com/presentation/d/1A2b3C4d5E6f7G8h9I0jKLMNOPqrstuv/embed?start=false&loop=false&delayms=3000');
    });

    it('matches a Google Forms responder link', () => {
      const result = matchEmbedService('https://docs.google.com/forms/d/e/1FAIpQLSdummyFormId123/viewform?usp=sf_link');

      expect(result?.service).toBe('googleforms');
      expect(result?.embedUrl).toBe('https://docs.google.com/forms/d/e/1FAIpQLSdummyFormId123/viewform?embedded=true');
    });
  });

  describe('Twitter/X URL variants', () => {
    it('matches a mobile.twitter.com status URL', () => {
      expect(matchEmbedService('https://mobile.twitter.com/jack/status/20')?.remoteId).toBe('20');
    });

    it('matches an /i/web/status/ deep link', () => {
      expect(matchEmbedService('https://x.com/i/web/status/20')?.remoteId).toBe('20');
    });

    it('does not match embed-proxy or foreign-prefixed URLs', () => {
      expect(matchEmbedService('https://fxtwitter.com/user/status/123')).toBeNull();
      expect(matchEmbedService('https://example.com/x.com/user/status/123')).toBeNull();
    });
  });

  describe('Telegram URL variants', () => {
    it('matches a web-preview t.me/s/ post link', () => {
      expect(matchEmbedService('https://t.me/s/durov/132')?.remoteId).toBe('durov/132');
    });

    it('matches telegram.me and telegram.dog domains', () => {
      expect(matchEmbedService('https://telegram.me/durov/123')?.remoteId).toBe('durov/123');
      expect(matchEmbedService('https://telegram.dog/durov/123')?.remoteId).toBe('durov/123');
    });

    it('targets the message id in a forum/topic link', () => {
      expect(matchEmbedService('https://t.me/mygroup/12/345')?.remoteId).toBe('mygroup/345');
    });

    it('does not match private t.me/c/ links (widget cannot render them)', () => {
      expect(matchEmbedService('https://t.me/c/1234567890/567')).toBeNull();
      expect(matchEmbedService('https://t.me/c/1234567890/2/567')).toBeNull();
    });

    it('does not match a lookalike host ending in t.me', () => {
      expect(matchEmbedService('https://nott.me/durov/123')).toBeNull();
    });
  });

  describe('paste pattern full-match contract', () => {
    // findToolForPattern requires the regex to consume the entire pasted text,
    // so share URLs with trailing query params must match fully to become embeds.
    const fullMatch = (service: string, url: string): boolean => {
      const regex = EMBED_SERVICES[service]?.regex;
      const exec = regex?.exec(url);

      return exec !== null && exec !== undefined && exec[0] === url;
    };

    it('consumes trailing share params on common share links', () => {
      expect(fullMatch('youtube', 'https://www.youtube.com/shorts/aqz-KE-bpKQ?si=XyZ')).toBe(true);
      expect(fullMatch('youtube', 'https://youtu.be/dQw4w9WgXcQ?si=abc')).toBe(true);
      expect(fullMatch('spotify', 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=x')).toBe(true);
      expect(fullMatch('googledrive', 'https://drive.google.com/file/d/FILEID/view?usp=sharing')).toBe(true);
      expect(fullMatch('vimeo', 'https://vimeo.com/800138810/fdcc90d662?share=copy')).toBe(true);
      expect(fullMatch('twitter', 'https://x.com/user/status/123?s=20')).toBe(true);
      expect(fullMatch('telegram', 'https://t.me/durov/123?single')).toBe(true);
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
