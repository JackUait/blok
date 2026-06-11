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

    it('matches a Google Forms link with an account-index segment', () => {
      const result = matchEmbedService('https://docs.google.com/forms/u/1/d/e/1FAIpQLSdummyFormId123/viewform');

      expect(result?.service).toBe('googleforms');
      expect(result?.embedUrl).toBe('https://docs.google.com/forms/d/e/1FAIpQLSdummyFormId123/viewform?embedded=true');
    });

    it('matches a legacy Google Forms link without the e/ segment', () => {
      const result = matchEmbedService('https://docs.google.com/forms/d/1r5zrO4VnIu8NGfNVIbjkWjRqsBubSh-JgehSL1vDm1k/viewform');

      expect(result?.service).toBe('googleforms');
      expect(result?.embedUrl).toBe('https://docs.google.com/forms/d/1r5zrO4VnIu8NGfNVIbjkWjRqsBubSh-JgehSL1vDm1k/viewform?embedded=true');
    });

    it('does not match forms.gle short links or form editor links', () => {
      expect(matchEmbedService('https://forms.gle/Ab3dEfGh12')).toBeNull();
      expect(matchEmbedService('https://docs.google.com/forms/d/1r5zrO4VnIu8NGfNVIbjkWjRqsBubSh-JgehSL1vDm1k/edit')).toBeNull();
    });
  });

  describe('Published Google Workspace (d/e/2PACX) URL variants', () => {
    const DOCS_TOKEN = '2PACX-1vQpBF5Z9a02DALDxXD652Vic622H';
    const SHEETS_TOKEN = '2PACX-1vTFW5Q43lfOxIM3DkQU68ROWGR2NKo';

    it('embeds a published Google Doc via its pub?embedded=true endpoint', () => {
      const result = matchEmbedService(`https://docs.google.com/document/d/e/${DOCS_TOKEN}/pub`);

      expect(result?.service).toBe('googledocspublished');
      expect(result?.embedUrl).toBe(`https://docs.google.com/document/d/e/${DOCS_TOKEN}/pub?embedded=true`);
    });

    it('matches published Google Doc account-index and protocol-less variants', () => {
      expect(matchEmbedService(`https://docs.google.com/document/u/0/d/e/${DOCS_TOKEN}/pub`)?.service).toBe('googledocspublished');
      expect(matchEmbedService(`docs.google.com/document/d/e/${DOCS_TOKEN}/pub?embedded=true`)?.service).toBe('googledocspublished');
    });

    it('still routes a doc id starting with the letter e to googledocs', () => {
      const result = matchEmbedService('https://docs.google.com/document/d/eAbCdEf1234567890qwerty/edit');

      expect(result?.service).toBe('googledocs');
      expect(result?.embedUrl).toBe('https://docs.google.com/document/d/eAbCdEf1234567890qwerty/preview');
    });

    it('embeds a published Google Sheet via pubhtml?widget=true&headers=false', () => {
      const result = matchEmbedService(`https://docs.google.com/spreadsheets/d/e/${SHEETS_TOKEN}/pubhtml`);

      expect(result?.service).toBe('googlesheets');
      expect(result?.embedUrl).toBe(`https://docs.google.com/spreadsheets/d/e/${SHEETS_TOKEN}/pubhtml?widget=true&headers=false`);
    });

    it('normalizes published Google Sheet export links to the pubhtml embed', () => {
      const result = matchEmbedService(`https://docs.google.com/spreadsheets/d/e/${SHEETS_TOKEN}/pub?output=csv`);

      expect(result?.embedUrl).toBe(`https://docs.google.com/spreadsheets/d/e/${SHEETS_TOKEN}/pubhtml?widget=true&headers=false`);
    });

    it('keeps the /preview embed for a normal Google Sheet link', () => {
      const result = matchEmbedService('https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0');

      expect(result?.embedUrl).toBe('https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/preview');
    });

    it('embeds a published Google Slides deck keeping the e/ prefix', () => {
      const result = matchEmbedService(`https://docs.google.com/presentation/d/e/${DOCS_TOKEN}/pub?start=false&loop=false&delayms=3000`);

      expect(result?.service).toBe('googleslides');
      expect(result?.embedUrl).toBe(`https://docs.google.com/presentation/d/e/${DOCS_TOKEN}/embed?start=false&loop=false&delayms=3000`);
    });

    it('still routes a presentation id starting with the letter e to the plain embed', () => {
      const result = matchEmbedService('https://docs.google.com/presentation/d/eXyZ123-abc/edit');

      expect(result?.embedUrl).toBe('https://docs.google.com/presentation/d/eXyZ123-abc/embed?start=false&loop=false&delayms=3000');
    });
  });

  describe('draw.io / diagrams.net URL variants', () => {
    const VIEWER_PUBLISHED =
      'https://viewer.diagrams.net/?tags=%7B%7D&lightbox=1&highlight=0000ff&edit=_blank&layers=1&nav=1&title=arch.drawio#Uhttps%3A%2F%2Fdrive.google.com%2Fuc%3Fid%3D1AbCdEfGhIjKlMnOp%26export%3Ddownload';

    it('embeds a published viewer link as-is', () => {
      const result = matchEmbedService(VIEWER_PUBLISHED);

      expect(result?.service).toBe('drawio');
      expect(result?.embedUrl).toBe(VIEWER_PUBLISHED);
    });

    it('adds lightbox params to a bare viewer #U link', () => {
      const result = matchEmbedService('https://viewer.diagrams.net/#Uhttps%3A%2F%2Fexample.com%2Fd.drawio');

      expect(result?.embedUrl).toBe('https://viewer.diagrams.net/?lightbox=1&nav=1#Uhttps%3A%2F%2Fexample.com%2Fd.drawio');
    });

    it('swaps app.diagrams.net editor links onto the frameable viewer host', () => {
      const result = matchEmbedService(
        'https://app.diagrams.net/?lightbox=1&highlight=0000ff&edit=_blank&layers=1&nav=1#Uhttps%3A%2F%2Fraw.githubusercontent.com%2Fjgraph%2Fdrawio%2Fmaster%2FTEMPLATE.drawio'
      );

      expect(result?.service).toBe('drawio');
      expect(result?.embedUrl).toBe(
        'https://viewer.diagrams.net/?lightbox=1&highlight=0000ff&edit=_blank&layers=1&nav=1#Uhttps%3A%2F%2Fraw.githubusercontent.com%2Fjgraph%2Fdrawio%2Fmaster%2FTEMPLATE.drawio'
      );
    });

    it('rewrites a #G Google Drive ref to the published-link viewer form', () => {
      const result = matchEmbedService('https://app.diagrams.net/#G1SkVL90deLHGYpv8hQ7uYHWZk6Ad7Q2BU');

      expect(result?.service).toBe('drawio');
      expect(result?.embedUrl).toBe(
        'https://viewer.diagrams.net/?tags=%7B%7D&lightbox=1&highlight=0000ff&layers=1&nav=1#Uhttps%3A%2F%2Fdrive.google.com%2Fuc%3Fid%3D1SkVL90deLHGYpv8hQ7uYHWZk6Ad7Q2BU%26export%3Ddownload'
      );
    });

    it('supports protocol-less and legacy draw.io hosts', () => {
      expect(matchEmbedService('app.diagrams.net/#G1SkVL90deLHGYpv8hQ7uYHWZk6Ad7Q2BU')?.service).toBe('drawio');

      const legacy = matchEmbedService('https://www.draw.io/?lightbox=1&edit=_blank#R7VtZc4JADP41Pj');

      expect(legacy?.service).toBe('drawio');
      expect(legacy?.embedUrl).toBe('https://viewer.diagrams.net/?lightbox=1&edit=_blank#R7VtZc4JADP41Pj');
    });

    it('does not match non-diagram diagrams.net pages or auth-bound refs', () => {
      expect(matchEmbedService('https://www.drawio.com/blog/publish-link')).toBeNull();
      expect(matchEmbedService('https://app.diagrams.net/')).toBeNull();
      expect(matchEmbedService('https://app.diagrams.net/#Hjgraph%2Fdrawio%2Fmaster%2FTEMPLATE.drawio')).toBeNull();
      expect(matchEmbedService('https://app.diagrams.net/#W!s!sequence-123')).toBeNull();
    });

    it('does not match lookalike or nested hosts', () => {
      expect(matchEmbedService('https://notapp.diagrams.net/#G12345')).toBeNull();
      expect(matchEmbedService('https://embed.diagrams.net/#G123')).toBeNull();
      expect(matchEmbedService('https://example.com/?u=https://viewer.diagrams.net/#Uhttps%3A%2F%2Fx')).toBeNull();
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

  describe('Bilibili URL variants', () => {
    it('matches a BV watch URL and builds the player query', () => {
      const result = matchEmbedService('https://www.bilibili.com/video/BV1GJ411x7h7/?spm_id_from=333.337');

      expect(result?.service).toBe('bilibili');
      expect(result?.embedUrl).toBe('https://player.bilibili.com/player.html?bvid=BV1GJ411x7h7&autoplay=0');
    });

    it('matches a legacy av-id URL via the aid param', () => {
      const result = matchEmbedService('https://www.bilibili.com/video/av170001');

      expect(result?.embedUrl).toBe('https://player.bilibili.com/player.html?aid=170001&autoplay=0');
    });

    it('matches mobile and b23.tv literal-id short links', () => {
      expect(matchEmbedService('https://m.bilibili.com/video/BV1GJ411x7h7')?.service).toBe('bilibili');
      expect(matchEmbedService('https://b23.tv/BV1GJ411x7h7')?.service).toBe('bilibili');
    });

    it('does not match opaque b23.tv shortcodes or lookalike hosts', () => {
      expect(matchEmbedService('https://b23.tv/x7GqkBz')).toBeNull();
      expect(matchEmbedService('https://notbilibili.com/video/BV1GJ411x7h7')).toBeNull();
    });
  });

  describe('Niconico URL variants', () => {
    it('matches a watch URL and keeps the prefixed id', () => {
      const result = matchEmbedService('https://www.nicovideo.jp/watch/sm9');

      expect(result?.service).toBe('niconico');
      expect(result?.embedUrl).toBe('https://embed.nicovideo.jp/watch/sm9');
    });

    it('matches nico.ms short links and mobile sp. URLs', () => {
      expect(matchEmbedService('https://nico.ms/sm9')?.embedUrl).toBe('https://embed.nicovideo.jp/watch/sm9');
      expect(matchEmbedService('https://sp.nicovideo.jp/watch/so46397782')?.service).toBe('niconico');
    });

    it('does not match watch URLs without an sm/nm/so prefix', () => {
      expect(matchEmbedService('https://www.nicovideo.jp/watch/12345')).toBeNull();
    });
  });

  describe('Youku URL variants', () => {
    it('matches a v_show watch URL and extracts the base64-ish id', () => {
      const result = matchEmbedService('https://v.youku.com/v_show/id_XODU1NzgzMTg0.html?spm=a2hbt.13141534.app.5~5!2~5!2~5~5~A');

      expect(result?.service).toBe('youku');
      expect(result?.embedUrl).toBe('https://player.youku.com/embed/XODU1NzgzMTg0');
    });

    it('keeps = padding and decodes %3D-encoded padding', () => {
      expect(matchEmbedService('https://v.youku.com/v_show/id_XNDM0NzA5NTc2OA==.html')?.embedUrl)
        .toBe('https://player.youku.com/embed/XNDM0NzA5NTc2OA==');
      expect(matchEmbedService('https://v.youku.com/v_show/id_XNDM0NzA5NTc2OA%3D%3D.html')?.embedUrl)
        .toBe('https://player.youku.com/embed/XNDM0NzA5NTc2OA==');
    });

    it('matches mobile video URLs', () => {
      expect(matchEmbedService('https://m.youku.com/video/id_XODU1NzgzMTg0.html')?.service).toBe('youku');
      expect(matchEmbedService('https://m.youku.com/alipay_video/id_XODU1NzgzMTg0.html')?.service).toBe('youku');
    });
  });

  describe('Naver TV URL variants', () => {
    it('matches a clip URL and disables autoplay in the embed', () => {
      const result = matchEmbedService('https://tv.naver.com/v/8565915');

      expect(result?.service).toBe('navertv');
      expect(result?.embedUrl).toBe('https://tv.naver.com/embed/8565915?autoPlay=false');
    });

    it('matches an already-embed URL', () => {
      expect(matchEmbedService('https://tv.naver.com/embed/8565915')?.service).toBe('navertv');
    });

    it('does not match opaque naver.me short links', () => {
      expect(matchEmbedService('https://naver.me/xyzAbc12')).toBeNull();
    });
  });

  describe('KakaoTV URL variants', () => {
    it('matches a short /v/ URL onto the play-tv embed host', () => {
      const result = matchEmbedService('https://tv.kakao.com/v/451075687');

      expect(result?.service).toBe('kakaotv');
      expect(result?.embedUrl).toBe('https://play-tv.kakao.com/embed/player/cliplink/451075687?service=player_share');
    });

    it('matches a canonical channel cliplink URL', () => {
      const result = matchEmbedService('https://tv.kakao.com/channel/462787/cliplink/451075687?metaObjectType=Clip');

      expect(result?.embedUrl).toBe('https://play-tv.kakao.com/embed/player/cliplink/451075687?service=player_share');
    });
  });

  describe('Dailymotion URL variants', () => {
    it('matches a watch URL via the geo player', () => {
      const result = matchEmbedService('https://www.dailymotion.com/video/xaehrai');

      expect(result?.service).toBe('dailymotion');
      expect(result?.embedUrl).toBe('https://geo.dailymotion.com/player.html?video=xaehrai');
    });

    it('matches a dai.ly short link (id is in the path)', () => {
      expect(matchEmbedService('https://dai.ly/x9pecme')?.embedUrl).toBe('https://geo.dailymotion.com/player.html?video=x9pecme');
    });

    it('does not match playlist pages', () => {
      expect(matchEmbedService('https://www.dailymotion.com/playlist/x5v0d4')).toBeNull();
    });
  });

  describe('OK.ru URL variants', () => {
    it('matches a video URL via the videoembed endpoint', () => {
      const result = matchEmbedService('https://ok.ru/video/7692086741685');

      expect(result?.service).toBe('okru');
      expect(result?.embedUrl).toBe('https://ok.ru/videoembed/7692086741685');
    });

    it('matches mobile, suffixed-id and legacy-domain URLs', () => {
      expect(matchEmbedService('https://m.ok.ru/video/157394084601186-0')?.embedUrl).toBe('https://ok.ru/videoembed/157394084601186-0');
      expect(matchEmbedService('https://odnoklassniki.ru/video/7692086741685')?.service).toBe('okru');
      expect(matchEmbedService('https://ok.ru/videoembed/7692086741685')?.service).toBe('okru');
    });

    it('does not match lookalike hosts', () => {
      expect(matchEmbedService('https://notok.ru/video/7692086741685')).toBeNull();
    });
  });

  describe('Yandex Music URL variants', () => {
    it('matches a track URL and reverses the track/album slot order', () => {
      const result = matchEmbedService('https://music.yandex.ru/album/11904129/track/70471675');

      expect(result?.service).toBe('yandexmusic');
      expect(result?.embedUrl).toBe('https://music.yandex.ru/iframe/track/70471675/11904129');
    });

    it('matches an album URL', () => {
      expect(matchEmbedService('https://music.yandex.ru/album/11904129')?.embedUrl)
        .toBe('https://music.yandex.ru/iframe/album/11904129');
    });

    it('matches a user playlist URL', () => {
      expect(matchEmbedService('https://music.yandex.ru/users/yamusic-bestsongs/playlists/1000')?.embedUrl)
        .toBe('https://music.yandex.ru/iframe/playlist/yamusic-bestsongs/1000');
    });

    it('matches the .com international mirror', () => {
      expect(matchEmbedService('https://music.yandex.com/album/11904129/track/70471675')?.service).toBe('yandexmusic');
    });
  });

  describe('Arte URL variants', () => {
    it('matches a program URL and keeps the language in the embed path', () => {
      const result = matchEmbedService('https://www.arte.tv/en/videos/110989-000-A/steven-spielberg/');

      expect(result?.service).toBe('arte');
      expect(result?.embedUrl).toBe('https://www.arte.tv/embeds/en/110989-000-A');
    });

    it('matches other site languages', () => {
      expect(matchEmbedService('https://www.arte.tv/fr/videos/110989-000-A/')?.embedUrl)
        .toBe('https://www.arte.tv/embeds/fr/110989-000-A');
    });

    it('does not match non-video pages', () => {
      expect(matchEmbedService('https://www.arte.tv/en/guide/')).toBeNull();
    });
  });

  describe('Deezer URL variants', () => {
    it('matches a track URL via the auto-theme widget', () => {
      const result = matchEmbedService('https://www.deezer.com/track/3135556');

      expect(result?.service).toBe('deezer');
      expect(result?.embedUrl).toBe('https://widget.deezer.com/widget/auto/track/3135556');
    });

    it('matches locale-prefixed album, playlist and episode URLs', () => {
      expect(matchEmbedService('https://www.deezer.com/en/album/302127')?.embedUrl)
        .toBe('https://widget.deezer.com/widget/auto/album/302127');
      expect(matchEmbedService('https://www.deezer.com/ru/playlist/1306931615')?.embedUrl)
        .toBe('https://widget.deezer.com/widget/auto/playlist/1306931615');
      expect(matchEmbedService('https://www.deezer.com/en/episode/452631745')?.embedUrl)
        .toBe('https://widget.deezer.com/widget/auto/episode/452631745');
    });

    it('does not match opaque link.deezer.com short links', () => {
      expect(matchEmbedService('https://link.deezer.com/s/30abc123xyz')).toBeNull();
    });
  });

  describe('SoundCloud URL variants', () => {
    it('matches a track URL and percent-encodes it into the widget url param', () => {
      const result = matchEmbedService('https://soundcloud.com/forss/flickermood');

      expect(result?.service).toBe('soundcloud');
      expect(result?.embedUrl).toBe(
        'https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fforss%2Fflickermood'
      );
    });

    it('matches a playlist (sets) URL', () => {
      const result = matchEmbedService('https://soundcloud.com/soundcloud/sets/tracks-of-the-week');

      expect(result?.embedUrl).toBe(
        'https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fsoundcloud%2Fsets%2Ftracks-of-the-week'
      );
    });

    it('strips share query params before encoding', () => {
      const result = matchEmbedService('https://soundcloud.com/forss/flickermood?si=abc&utm_source=clipboard');

      expect(result?.embedUrl).toBe(
        'https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fforss%2Fflickermood'
      );
    });

    it('does not match profile tab pages or opaque short links', () => {
      expect(matchEmbedService('https://soundcloud.com/forss/tracks')).toBeNull();
      expect(matchEmbedService('https://on.soundcloud.com/0elNQxGgHZWep2hzUT')).toBeNull();
    });
  });

  describe('Mixcloud URL variants', () => {
    it('matches a show URL and encodes the permalink into the feed param', () => {
      const result = matchEmbedService('https://www.mixcloud.com/spartacus/party-time/');

      expect(result?.service).toBe('mixcloud');
      expect(result?.embedUrl).toBe(
        'https://www.mixcloud.com/widget/iframe/?feed=https%3A%2F%2Fwww.mixcloud.com%2Fspartacus%2Fparty-time%2F&hide_cover=1'
      );
    });

    it('does not match playlist pages (no widget feed)', () => {
      expect(matchEmbedService('https://www.mixcloud.com/spartacus/playlists/best-of/')).toBeNull();
    });
  });

  describe('Apple Music URL variants', () => {
    it('matches an album URL via the embed subdomain', () => {
      const result = matchEmbedService('https://music.apple.com/us/album/1989-taylors-version/1708308989');

      expect(result?.service).toBe('applemusic');
      expect(result?.embedUrl).toBe('https://embed.music.apple.com/us/album/1989-taylors-version/1708308989');
    });

    it('keeps the ?i= track selector of a song-in-album link', () => {
      const result = matchEmbedService('https://music.apple.com/us/album/1989-taylors-version/1708308989?i=1708308990');

      expect(result?.embedUrl).toBe('https://embed.music.apple.com/us/album/1989-taylors-version/1708308989?i=1708308990');
    });

    it('matches direct song and playlist links', () => {
      expect(matchEmbedService('https://music.apple.com/us/song/welcome-to-new-york-taylors-version/1708308990')?.embedUrl)
        .toBe('https://embed.music.apple.com/us/song/welcome-to-new-york-taylors-version/1708308990');
      expect(matchEmbedService('https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb')?.embedUrl)
        .toBe('https://embed.music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb');
    });
  });

  describe('Apple Podcasts URL variants', () => {
    it('matches a show URL via the embed subdomain', () => {
      const result = matchEmbedService('https://podcasts.apple.com/us/podcast/the-daily/id1200361736');

      expect(result?.service).toBe('applepodcasts');
      expect(result?.embedUrl).toBe('https://embed.podcasts.apple.com/us/podcast/the-daily/id1200361736');
    });

    it('keeps the ?i= episode selector', () => {
      const result = matchEmbedService('https://podcasts.apple.com/us/podcast/the-daily/id1200361736?i=1000772009313');

      expect(result?.embedUrl).toBe('https://embed.podcasts.apple.com/us/podcast/the-daily/id1200361736?i=1000772009313');
    });
  });

  describe('Audiomack URL variants', () => {
    it('matches a song URL and rearranges path slots into the embed form', () => {
      const result = matchEmbedService('https://audiomack.com/innercatmusic/song/allegro-in-b-flat-k-3');

      expect(result?.service).toBe('audiomack');
      expect(result?.embedUrl).toBe('https://audiomack.com/embed/song/innercatmusic/allegro-in-b-flat-k-3');
    });

    it('matches album and playlist URLs', () => {
      expect(matchEmbedService('https://audiomack.com/asakemusic/album/mney-1073854')?.embedUrl)
        .toBe('https://audiomack.com/embed/album/asakemusic/mney-1073854');
      expect(matchEmbedService('https://audiomack.com/audiomack-hip-hop/playlist/verified-hh')?.embedUrl)
        .toBe('https://audiomack.com/embed/playlist/audiomack-hip-hop/verified-hh');
    });
  });

  describe('Anghami URL variants', () => {
    it('matches a song URL via the widget host', () => {
      const result = matchEmbedService('https://play.anghami.com/song/45385197');

      expect(result?.service).toBe('anghami');
      expect(result?.embedUrl).toBe('https://widget.anghami.com/song/45385197');
    });

    it('matches album, playlist and artist URLs', () => {
      expect(matchEmbedService('https://play.anghami.com/album/1010655195')?.embedUrl).toBe('https://widget.anghami.com/album/1010655195');
      expect(matchEmbedService('https://play.anghami.com/playlist/170320738')?.embedUrl).toBe('https://widget.anghami.com/playlist/170320738');
      expect(matchEmbedService('https://play.anghami.com/artist/859')?.embedUrl).toBe('https://widget.anghami.com/artist/859');
    });
  });

  describe('Streamable URL variants', () => {
    it('matches a short video URL via the /e/ embed path', () => {
      const result = matchEmbedService('https://streamable.com/moo');

      expect(result?.service).toBe('streamable');
      expect(result?.embedUrl).toBe('https://streamable.com/e/moo');
    });

    it('matches an already-embed /e/ URL', () => {
      expect(matchEmbedService('https://streamable.com/e/moo')?.embedUrl).toBe('https://streamable.com/e/moo');
    });

    it('does not match site pages like login or signup', () => {
      expect(matchEmbedService('https://streamable.com/login')).toBeNull();
      expect(matchEmbedService('https://streamable.com/signup')).toBeNull();
    });
  });

  describe('TikTok URL variants', () => {
    it('matches a video URL via the embed/v2 endpoint', () => {
      const result = matchEmbedService('https://www.tiktok.com/@javiercazarez/video/7469789434322455863');

      expect(result?.service).toBe('tiktok');
      expect(result?.embedUrl).toBe('https://www.tiktok.com/embed/v2/7469789434322455863');
    });

    it('does not match opaque vm./vt. short links or photo posts', () => {
      expect(matchEmbedService('https://vm.tiktok.com/ZMabc123/')).toBeNull();
      expect(matchEmbedService('https://vt.tiktok.com/ZSabc123/')).toBeNull();
      expect(matchEmbedService('https://www.tiktok.com/@user/photo/7469789434322455863')).toBeNull();
    });
  });

  describe('Wistia URL variants', () => {
    it('matches an account medias URL via fast.wistia.net', () => {
      const result = matchEmbedService('https://support.wistia.com/medias/h1z3uqsjal');

      expect(result?.service).toBe('wistia');
      expect(result?.embedUrl).toBe('https://fast.wistia.net/embed/iframe/h1z3uqsjal');
    });

    it('matches pasted embed iframe URLs on both wistia hosts', () => {
      expect(matchEmbedService('https://fast.wistia.net/embed/iframe/a74mrwu4wi')?.embedUrl)
        .toBe('https://fast.wistia.net/embed/iframe/a74mrwu4wi');
      expect(matchEmbedService('https://fast.wistia.com/embed/iframe/a74mrwu4wi')?.service).toBe('wistia');
    });
  });

  describe('Vidyard URL variants', () => {
    it('matches a share watch URL via the play host', () => {
      const result = matchEmbedService('https://share.vidyard.com/watch/h2NqLfsfpLszhtLg1mXnAZ');

      expect(result?.service).toBe('vidyard');
      expect(result?.embedUrl).toBe('https://play.vidyard.com/h2NqLfsfpLszhtLg1mXnAZ.html');
    });

    it('matches custom-subdomain and prefixed watch URLs', () => {
      expect(matchEmbedService('https://video.vidyard.com/watch/CjSiQ8JRYjt9QYTTgnUUqT')?.service).toBe('vidyard');
      expect(matchEmbedService('https://learn.vidyard.com/gettingstarted/watch/RyjoKvH8QTAPtYrfejha95')?.embedUrl)
        .toBe('https://play.vidyard.com/RyjoKvH8QTAPtYrfejha95.html');
    });

    it('strips share query params from the captured id', () => {
      expect(matchEmbedService('https://share.vidyard.com/watch/h2NqLfsfpLszhtLg1mXnAZ?second=30')?.embedUrl)
        .toBe('https://play.vidyard.com/h2NqLfsfpLszhtLg1mXnAZ.html');
    });
  });

  describe('Giphy URL variants', () => {
    it('matches a gif page URL and captures the trailing id token', () => {
      const result = matchEmbedService('https://giphy.com/gifs/lustig-witzig-funny-reaction-cJhDKXoHvzahcGPgiK');

      expect(result?.service).toBe('giphy');
      expect(result?.embedUrl).toBe('https://giphy.com/embed/cJhDKXoHvzahcGPgiK');
    });

    it('matches slugless gif, clip and sticker URLs', () => {
      expect(matchEmbedService('https://giphy.com/gifs/cJhDKXoHvzahcGPgiK')?.embedUrl).toBe('https://giphy.com/embed/cJhDKXoHvzahcGPgiK');
      expect(matchEmbedService('https://giphy.com/clips/some-clip-cJhDKXoHvzahcGPgiK')?.service).toBe('giphy');
      expect(matchEmbedService('https://giphy.com/stickers/some-sticker-cJhDKXoHvzahcGPgiK')?.service).toBe('giphy');
    });

    it('matches a direct media.giphy.com GIF link', () => {
      expect(matchEmbedService('https://media.giphy.com/media/cJhDKXoHvzahcGPgiK/giphy.gif')?.embedUrl)
        .toBe('https://giphy.com/embed/cJhDKXoHvzahcGPgiK');
    });

    it('does not match opaque gph.is short links', () => {
      expect(matchEmbedService('https://gph.is/2x6lvCS')).toBeNull();
    });
  });

  describe('CodeSandbox URL variants', () => {
    it('matches a legacy /s/ sandbox URL via the embed path', () => {
      const result = matchEmbedService('https://codesandbox.io/s/vanilla');

      expect(result?.service).toBe('codesandbox');
      expect(result?.embedUrl).toBe('https://codesandbox.io/embed/vanilla');
    });

    it('matches current /p/sandbox/ and already-embed URLs', () => {
      expect(matchEmbedService('https://codesandbox.io/p/sandbox/vanilla')?.embedUrl).toBe('https://codesandbox.io/embed/vanilla');
      expect(matchEmbedService('https://codesandbox.io/embed/my-app-x7k2v')?.embedUrl).toBe('https://codesandbox.io/embed/my-app-x7k2v');
    });

    it('does not match devbox URLs (embed mapping unverified)', () => {
      expect(matchEmbedService('https://codesandbox.io/p/devbox/my-devbox-abc123')).toBeNull();
    });
  });

  describe('StackBlitz URL variants', () => {
    it('matches an edit URL and appends embed=1', () => {
      const result = matchEmbedService('https://stackblitz.com/edit/react-ts');

      expect(result?.service).toBe('stackblitz');
      expect(result?.embedUrl).toBe('https://stackblitz.com/edit/react-ts?embed=1');
    });

    it('preserves existing query params like file=', () => {
      expect(matchEmbedService('https://stackblitz.com/edit/vitejs-vite-y8mdxg?file=src%2FApp.tsx')?.embedUrl)
        .toBe('https://stackblitz.com/edit/vitejs-vite-y8mdxg?embed=1&file=src%2FApp.tsx');
    });
  });

  describe('Typeform URL variants', () => {
    it('matches a form URL keeping the original subdomain', () => {
      const result = matchEmbedService('https://form.typeform.com/to/LQcTJr');

      expect(result?.service).toBe('typeform');
      expect(result?.embedUrl).toBe('https://form.typeform.com/to/LQcTJr');
    });

    it('matches custom workspace subdomains', () => {
      expect(matchEmbedService('https://mycompany.typeform.com/to/OeM7lVCD')?.embedUrl)
        .toBe('https://mycompany.typeform.com/to/OeM7lVCD');
    });
  });

  describe('Airtable URL variants', () => {
    it('matches a bare share link via the embed path', () => {
      const result = matchEmbedService('https://airtable.com/shr5EBHUmHzStubDx');

      expect(result?.service).toBe('airtable');
      expect(result?.embedUrl).toBe('https://airtable.com/embed/shr5EBHUmHzStubDx');
    });

    it('keeps the app prefix of expanded share links', () => {
      expect(matchEmbedService('https://airtable.com/appQ01ZB5fUkC9w7q/shr5EBHUmHzStubDx')?.embedUrl)
        .toBe('https://airtable.com/embed/appQ01ZB5fUkC9w7q/shr5EBHUmHzStubDx');
    });

    it('does not match auth-only workspace URLs without a share id', () => {
      expect(matchEmbedService('https://airtable.com/appQ01ZB5fUkC9w7q/tblXYZ/viwABC')).toBeNull();
    });
  });

  describe('Miro URL variants', () => {
    it('matches a board URL via the live-embed path', () => {
      const result = matchEmbedService('https://miro.com/app/board/uXjVOUbVyFY=/');

      expect(result?.service).toBe('miro');
      expect(result?.embedUrl).toBe('https://miro.com/app/live-embed/uXjVOUbVyFY=/');
    });

    it('decodes a percent-encoded board id and strips share params', () => {
      expect(matchEmbedService('https://miro.com/app/board/uXjVOUbVyFY%3D/?share_link_id=123')?.embedUrl)
        .toBe('https://miro.com/app/live-embed/uXjVOUbVyFY=/');
    });
  });

  describe('Desmos URL variants', () => {
    it('matches a calculator graph URL and appends ?embed', () => {
      const result = matchEmbedService('https://www.desmos.com/calculator/qy6jc8mfi9');

      expect(result?.service).toBe('desmos');
      expect(result?.embedUrl).toBe('https://www.desmos.com/calculator/qy6jc8mfi9?embed');
    });

    it('does not match the bare calculator page', () => {
      expect(matchEmbedService('https://www.desmos.com/calculator')).toBeNull();
    });
  });

  describe('Observable URL variants', () => {
    it('matches a notebook URL via the embed path', () => {
      const result = matchEmbedService('https://observablehq.com/@mbostock/embedded-notebook');

      expect(result?.service).toBe('observable');
      expect(result?.embedUrl).toBe('https://observablehq.com/embed/@mbostock/embedded-notebook');
    });

    it('matches an already-embed URL', () => {
      expect(matchEmbedService('https://observablehq.com/embed/@mbostock/embedded-notebook')?.service).toBe('observable');
    });

    it('does not match bare profile pages', () => {
      expect(matchEmbedService('https://observablehq.com/@mbostock')).toBeNull();
    });
  });

  describe('JSFiddle URL variants', () => {
    it('matches a user fiddle URL via the embedded path', () => {
      const result = matchEmbedService('https://jsfiddle.net/josewirewax/2rqnsdd6/');

      expect(result?.service).toBe('jsfiddle');
      expect(result?.embedUrl).toBe('https://jsfiddle.net/josewirewax/2rqnsdd6/embedded/');
    });

    it('matches anonymous and revisioned fiddles', () => {
      expect(matchEmbedService('https://jsfiddle.net/BDC9Q/328/')?.embedUrl).toBe('https://jsfiddle.net/BDC9Q/328/embedded/');
      expect(matchEmbedService('https://jsfiddle.net/2rqnsdd6/')?.embedUrl).toBe('https://jsfiddle.net/2rqnsdd6/embedded/');
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

    it('consumes the entire URL on the new published-google and drawio patterns', () => {
      expect(fullMatch('googledocspublished', 'https://docs.google.com/document/d/e/2PACX-1vQpBF5Z9a02DAL/pub?embedded=true')).toBe(true);
      expect(fullMatch('googlesheets', 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTFW5Q43lfOxIM/pubhtml?gid=0&single=true')).toBe(true);
      expect(fullMatch('googleslides', 'https://docs.google.com/presentation/d/e/2PACX-1vRxK9_aBcDeF/pub?start=false&loop=false&delayms=3000')).toBe(true);
      expect(fullMatch('googleforms', 'https://docs.google.com/forms/u/0/d/e/1FAIpQLSdummy/viewform?embedded=true')).toBe(true);
      expect(fullMatch('drawio', 'https://app.diagrams.net/#G1SkVL90deLHGYpv8hQ7uYHWZk6Ad7Q2BU')).toBe(true);
      expect(fullMatch('drawio', 'https://viewer.diagrams.net/?lightbox=1&nav=1#Uhttps%3A%2F%2Fexample.com%2Fd.drawio')).toBe(true);
    });

    it('consumes the entire URL on the worldwide service patterns', () => {
      expect(fullMatch('bilibili', 'https://www.bilibili.com/video/BV1GJ411x7h7/?spm_id_from=333.337&vd_source=abc')).toBe(true);
      expect(fullMatch('niconico', 'https://www.nicovideo.jp/watch/sm9?ref=search')).toBe(true);
      expect(fullMatch('youku', 'https://v.youku.com/v_show/id_XODU1NzgzMTg0.html?spm=a2hbt.13141534')).toBe(true);
      expect(fullMatch('navertv', 'https://tv.naver.com/v/8565915?playlistNo=12')).toBe(true);
      expect(fullMatch('kakaotv', 'https://tv.kakao.com/channel/462787/cliplink/451075687?metaObjectType=Clip')).toBe(true);
      expect(fullMatch('dailymotion', 'https://www.dailymotion.com/video/xaehrai?playlist=x5v0d4')).toBe(true);
      expect(fullMatch('okru', 'https://ok.ru/video/7692086741685?fromTime=10')).toBe(true);
      expect(fullMatch('yandexmusic', 'https://music.yandex.ru/album/11904129/track/70471675?utm_medium=copy_link')).toBe(true);
      expect(fullMatch('arte', 'https://www.arte.tv/en/videos/110989-000-A/steven-spielberg/')).toBe(true);
      expect(fullMatch('deezer', 'https://www.deezer.com/en/track/3135556?utm_campaign=clipboard-generic')).toBe(true);
      expect(fullMatch('soundcloud', 'https://soundcloud.com/forss/flickermood?si=abc&utm_source=clipboard')).toBe(true);
      expect(fullMatch('mixcloud', 'https://www.mixcloud.com/spartacus/party-time/?utm_source=widget')).toBe(true);
      expect(fullMatch('applemusic', 'https://music.apple.com/us/album/1989-taylors-version/1708308989?i=1708308990')).toBe(true);
      expect(fullMatch('applepodcasts', 'https://podcasts.apple.com/us/podcast/the-daily/id1200361736?i=1000772009313')).toBe(true);
      expect(fullMatch('audiomack', 'https://audiomack.com/asakemusic/album/mney-1073854?utm_source=share')).toBe(true);
      expect(fullMatch('anghami', 'https://play.anghami.com/song/45385197?refer=share')).toBe(true);
      expect(fullMatch('streamable', 'https://streamable.com/moo?src=player-page-share')).toBe(true);
      expect(fullMatch('tiktok', 'https://www.tiktok.com/@javiercazarez/video/7469789434322455863?is_from_webapp=1&sender_device=pc')).toBe(true);
      expect(fullMatch('wistia', 'https://support.wistia.com/medias/h1z3uqsjal?wtime=30s')).toBe(true);
      expect(fullMatch('vidyard', 'https://share.vidyard.com/watch/h2NqLfsfpLszhtLg1mXnAZ?second=30')).toBe(true);
      expect(fullMatch('giphy', 'https://giphy.com/gifs/lustig-witzig-funny-reaction-cJhDKXoHvzahcGPgiK?utm_source=share')).toBe(true);
      expect(fullMatch('codesandbox', 'https://codesandbox.io/p/sandbox/vanilla?file=%2Findex.js')).toBe(true);
      expect(fullMatch('stackblitz', 'https://stackblitz.com/edit/vitejs-vite-y8mdxg?file=src%2FApp.tsx')).toBe(true);
      expect(fullMatch('typeform', 'https://form.typeform.com/to/LQcTJr?typeform-source=google.com')).toBe(true);
      expect(fullMatch('airtable', 'https://airtable.com/shr5EBHUmHzStubDx?backgroundColor=blue')).toBe(true);
      expect(fullMatch('miro', 'https://miro.com/app/board/uXjVOUbVyFY=/?share_link_id=123456')).toBe(true);
      expect(fullMatch('desmos', 'https://www.desmos.com/calculator/qy6jc8mfi9?lang=ru')).toBe(true);
      expect(fullMatch('observable', 'https://observablehq.com/@mbostock/embedded-notebook?collection=@observablehq/embeds')).toBe(true);
      expect(fullMatch('jsfiddle', 'https://jsfiddle.net/josewirewax/2rqnsdd6/')).toBe(true);
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

    it('inserts remote ids containing replacement patterns literally', () => {
      expect(buildEmbedUrl('youtube', 'a$&b')).toBe('https://www.youtube.com/embed/a$&b');
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
