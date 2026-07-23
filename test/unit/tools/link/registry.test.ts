import { describe, it, expect } from 'vitest';
import {
  matchEmbedService,
  buildEmbedUrl,
  isHttpUrl,
  isSamePageLink,
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

    it('matches a playlist-scoped watch URL (what VK copies while watching from a playlist)', () => {
      const result = matchEmbedService('https://vkvideo.ru/playlist/-226723792_5/video-226723792_456239233?t=11m38s');

      expect(result?.service).toBe('vkvideo');
      expect(result?.embedUrl).toBe('https://vk.com/video_ext.php?oid=-226723792&id=456239233');
    });

    it('does not match a playlist listing page with no video segment', () => {
      expect(matchEmbedService('https://vkvideo.ru/playlist/-226723792_5')).toBeNull();
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
      expect(matchEmbedService('https://www.mixcloud.com/spartacus/playlists')).toBeNull();
      expect(matchEmbedService('https://www.mixcloud.com/spartacus/playlists?tab=shows')).toBeNull();
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

    it('does not match site pages like about or docs', () => {
      expect(matchEmbedService('https://jsfiddle.net/about')).toBeNull();
      expect(matchEmbedService('https://jsfiddle.net/docs')).toBeNull();
      expect(matchEmbedService('https://jsfiddle.net/user/login/')).toBeNull();
    });
  });

  describe('Reddit URL variants', () => {
    it('matches a post permalink via embed.reddit.com', () => {
      const result = matchEmbedService('https://www.reddit.com/r/programming/comments/1abc2de/some_title_slug/');

      expect(result?.service).toBe('reddit');
      expect(result?.embedUrl).toBe('https://embed.reddit.com/r/programming/comments/1abc2de/some_title_slug?embed=true&ref_source=embed&ref=share');
    });

    it('matches old.reddit and slugless permalinks, stripping share params', () => {
      expect(matchEmbedService('https://old.reddit.com/r/AskReddit/comments/xyz123/')?.embedUrl)
        .toBe('https://embed.reddit.com/r/AskReddit/comments/xyz123?embed=true&ref_source=embed&ref=share');
      expect(matchEmbedService('https://www.reddit.com/r/programming/comments/1abc2de/some_title_slug/?utm_source=share&utm_medium=web2x')?.embedUrl)
        .toBe('https://embed.reddit.com/r/programming/comments/1abc2de/some_title_slug?embed=true&ref_source=embed&ref=share');
    });

    it('does not match mobile /s/ share tokens, redd.it or non-post pages', () => {
      expect(matchEmbedService('https://www.reddit.com/r/programming/s/AbCdEfGh')).toBeNull();
      expect(matchEmbedService('https://redd.it/1abc2de')).toBeNull();
      expect(matchEmbedService('https://www.reddit.com/r/programming/')).toBeNull();
      expect(matchEmbedService('https://www.reddit.com/user/spez/')).toBeNull();
    });
  });

  describe('Instagram URL variants', () => {
    it('matches a post URL via the captioned embed endpoint', () => {
      const result = matchEmbedService('https://www.instagram.com/p/C8zXq1NMabc/');

      expect(result?.service).toBe('instagram');
      expect(result?.embedUrl).toBe('https://www.instagram.com/p/C8zXq1NMabc/embed/captioned/');
    });

    it('normalizes reel, reels, tv and instagr.am forms onto /p/', () => {
      expect(matchEmbedService('https://www.instagram.com/reel/C8zXq1NMabc/?igsh=xyz123')?.embedUrl)
        .toBe('https://www.instagram.com/p/C8zXq1NMabc/embed/captioned/');
      expect(matchEmbedService('https://www.instagram.com/reels/C8zXq1NMabc/')?.embedUrl)
        .toBe('https://www.instagram.com/p/C8zXq1NMabc/embed/captioned/');
      expect(matchEmbedService('https://www.instagram.com/tv/B8zXq1NMabc/')?.embedUrl)
        .toBe('https://www.instagram.com/p/B8zXq1NMabc/embed/captioned/');
      expect(matchEmbedService('https://instagr.am/p/C8zXq1NMabc/')?.embedUrl)
        .toBe('https://www.instagram.com/p/C8zXq1NMabc/embed/captioned/');
    });

    it('does not match profiles, stories or lookalike hosts', () => {
      expect(matchEmbedService('https://www.instagram.com/zuck/')).toBeNull();
      expect(matchEmbedService('https://www.instagram.com/stories/zuck/3141592653589793238/')).toBeNull();
      expect(matchEmbedService('https://notinstagram.com/p/C8zXq1NMabc/')).toBeNull();
    });
  });

  describe('Facebook video URL variants', () => {
    it('matches a page video URL and encodes the canonical href into the plugin', () => {
      const result = matchEmbedService('https://www.facebook.com/facebook/videos/10153231379946729/');

      expect(result?.service).toBe('facebookvideo');
      expect(result?.embedUrl).toBe(
        'https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Ffacebook%2Fvideos%2F10153231379946729%2F'
      );
    });

    it('matches watch?v= and reel forms', () => {
      expect(matchEmbedService('https://www.facebook.com/watch/?v=10153231379946729')?.embedUrl)
        .toBe('https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Fwatch%2F%3Fv%3D10153231379946729');
      expect(matchEmbedService('https://www.facebook.com/watch?v=10153231379946729')?.service).toBe('facebookvideo');
      expect(matchEmbedService('https://www.facebook.com/reel/3065759583668375')?.embedUrl)
        .toBe('https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Freel%2F3065759583668375');
    });

    it('matches mobile and slugged video URLs onto the canonical form', () => {
      expect(matchEmbedService('https://m.facebook.com/page.name/videos/123456/')?.embedUrl)
        .toBe('https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Fpage.name%2Fvideos%2F123456%2F');
      expect(matchEmbedService('https://www.facebook.com/SomePage/videos/funny-clip-title/123456789/')?.embedUrl)
        .toBe('https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2FSomePage%2Fvideos%2F123456789%2F');
    });

    it('does not match opaque fb.watch short links', () => {
      expect(matchEmbedService('https://fb.watch/abc123/')).toBeNull();
    });
  });

  describe('Facebook post URL variants', () => {
    it('matches a page post URL and encodes the permalink into the plugin', () => {
      const result = matchEmbedService('https://www.facebook.com/zuck/posts/pfbid02abcDEF123xyz');

      expect(result?.service).toBe('facebookpost');
      expect(result?.embedUrl).toBe(
        'https://www.facebook.com/plugins/post.php?href=https%3A%2F%2Fwww.facebook.com%2Fzuck%2Fposts%2Fpfbid02abcDEF123xyz&show_text=true'
      );
    });

    it('matches permalink.php with params in either order', () => {
      const expected =
        'https://www.facebook.com/plugins/post.php?href=https%3A%2F%2Fwww.facebook.com%2Fpermalink.php%3Fstory_fbid%3Dpfbid0abc123%26id%3D100044112233&show_text=true';

      expect(matchEmbedService('https://www.facebook.com/permalink.php?story_fbid=pfbid0abc123&id=100044112233')?.embedUrl).toBe(expected);
      expect(matchEmbedService('https://www.facebook.com/permalink.php?id=100044112233&story_fbid=pfbid0abc123')?.embedUrl).toBe(expected);
    });

    it('matches photo.php links keeping only the fbid', () => {
      const expected =
        'https://www.facebook.com/plugins/post.php?href=https%3A%2F%2Fwww.facebook.com%2Fphoto.php%3Ffbid%3D1234567890&show_text=true';

      expect(matchEmbedService('https://www.facebook.com/photo.php?fbid=1234567890&set=a.456&type=3')?.embedUrl).toBe(expected);
      expect(matchEmbedService('https://www.facebook.com/photo/?fbid=1234567890')?.embedUrl).toBe(expected);
    });

    it('routes video URLs to facebookvideo, never facebookpost', () => {
      expect(matchEmbedService('https://www.facebook.com/facebook/videos/10153231379946729/')?.service).toBe('facebookvideo');
      expect(matchEmbedService('https://www.facebook.com/watch/?v=10153231379946729')?.service).toBe('facebookvideo');
    });

    it('does not match opaque /share/p/ tokens or group pages', () => {
      expect(matchEmbedService('https://www.facebook.com/share/p/AbCdEf123/')).toBeNull();
      expect(matchEmbedService('https://www.facebook.com/share/v/AbCdEf123/')).toBeNull();
      expect(matchEmbedService('https://www.facebook.com/groups/123456/')).toBeNull();
    });
  });

  describe('LinkedIn URL variants', () => {
    it('matches a posts share slug and extracts the activity id', () => {
      const result = matchEmbedService('https://www.linkedin.com/posts/john-doe-123_great-stuff-activity-7123456789012345678-AbCd?utm_source=share');

      expect(result?.service).toBe('linkedin');
      expect(result?.embedUrl).toBe('https://www.linkedin.com/embed/feed/update/urn:li:activity:7123456789012345678');
    });

    it('matches feed/update urn links and mirrors the urn type', () => {
      expect(matchEmbedService('https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/')?.embedUrl)
        .toBe('https://www.linkedin.com/embed/feed/update/urn:li:activity:7123456789012345678');
      expect(matchEmbedService('https://www.linkedin.com/feed/update/urn:li:ugcPost:7123456789012345678')?.embedUrl)
        .toBe('https://www.linkedin.com/embed/feed/update/urn:li:ugcPost:7123456789012345678');
      expect(matchEmbedService('https://www.linkedin.com/feed/update/urn:li:share:7123456789012345678')?.embedUrl)
        .toBe('https://www.linkedin.com/embed/feed/update/urn:li:share:7123456789012345678');
    });

    it('does not match lnkd.in short links, profiles or lookalike hosts', () => {
      expect(matchEmbedService('https://lnkd.in/abc123')).toBeNull();
      expect(matchEmbedService('https://www.linkedin.com/in/john-doe/')).toBeNull();
      expect(matchEmbedService('https://notlinkedin.com/posts/x-activity-7123456789012345678-AbCd')).toBeNull();
    });
  });

  describe('Mastodon URL variants', () => {
    it('matches a status on an allowlisted instance via its /embed endpoint', () => {
      const result = matchEmbedService('https://mastodon.social/@Gargron/100254678717223630');

      expect(result?.service).toBe('mastodon');
      expect(result?.embedUrl).toBe('https://mastodon.social/@Gargron/100254678717223630/embed');
    });

    it('matches other allowlisted instances and remote-account statuses', () => {
      expect(matchEmbedService('https://hachyderm.io/@nova/109372843329177955?x=1')?.embedUrl)
        .toBe('https://hachyderm.io/@nova/109372843329177955/embed');
      expect(matchEmbedService('https://mastodon.social/@user@example.com/100254678717223630')?.embedUrl)
        .toBe('https://mastodon.social/@user@example.com/100254678717223630/embed');
    });

    it('does not match non-allowlisted instances or profile pages', () => {
      expect(matchEmbedService('https://myrandominstance.xyz/@user/100254678717223630')).toBeNull();
      expect(matchEmbedService('https://mastodon.social/@Gargron')).toBeNull();
      expect(matchEmbedService('https://notmastodon.social/@user/100254678717223630')).toBeNull();
    });
  });

  describe('Pinterest URL variants', () => {
    it('matches a pin URL via the assets embed endpoint', () => {
      const result = matchEmbedService('https://www.pinterest.com/pin/99360735500167749/');

      expect(result?.service).toBe('pinterest');
      expect(result?.embedUrl).toBe('https://assets.pinterest.com/ext/embed.html?id=99360735500167749');
    });

    it('matches regional subdomains and TLDs', () => {
      expect(matchEmbedService('https://ru.pinterest.com/pin/99360735500167749/')?.embedUrl)
        .toBe('https://assets.pinterest.com/ext/embed.html?id=99360735500167749');
      expect(matchEmbedService('https://pinterest.co.uk/pin/99360735500167749')?.embedUrl)
        .toBe('https://assets.pinterest.com/ext/embed.html?id=99360735500167749');
    });

    it('does not match pin.it short links, boards or lookalike hosts', () => {
      expect(matchEmbedService('https://pin.it/AbCd123')).toBeNull();
      expect(matchEmbedService('https://www.pinterest.com/someuser/board-name/')).toBeNull();
      expect(matchEmbedService('https://pinterest.evil.com/pin/99360735500167749/')).toBeNull();
    });
  });

  describe('Snapchat URL variants', () => {
    it('matches a spotlight URL by appending /embed', () => {
      const result = matchEmbedService('https://www.snapchat.com/spotlight/W7_EDlXWTBiXAEEniNoMPwAAYdWxucXBwZGZoAZSjJAfsAZSjJAJBAAAAAA');

      expect(result?.service).toBe('snapchat');
      expect(result?.embedUrl).toBe('https://www.snapchat.com/spotlight/W7_EDlXWTBiXAEEniNoMPwAAYdWxucXBwZGZoAZSjJAfsAZSjJAJBAAAAAA/embed');
    });

    it('matches a 32-hex lens URL', () => {
      expect(matchEmbedService('https://www.snapchat.com/lens/0123456789abcdef0123456789abcdef?type=SNAPCODE')?.embedUrl)
        .toBe('https://www.snapchat.com/lens/0123456789abcdef0123456789abcdef/embed');
    });

    it('does not match profiles or non-hex lens ids', () => {
      expect(matchEmbedService('https://www.snapchat.com/add/someuser')).toBeNull();
      expect(matchEmbedService('https://www.snapchat.com/@someuser')).toBeNull();
      expect(matchEmbedService('https://www.snapchat.com/lens/notahex')).toBeNull();
    });
  });

  describe('Substack URL variants', () => {
    it('matches a post URL via the publication /embed/p/ endpoint', () => {
      const result = matchEmbedService('https://astralcodexten.substack.com/p/some-post-slug');

      expect(result?.service).toBe('substack');
      expect(result?.embedUrl).toBe('https://astralcodexten.substack.com/embed/p/some-post-slug');
    });

    it('strips share params and tolerates a trailing slash', () => {
      expect(matchEmbedService('https://astralcodexten.substack.com/p/some-post-slug?utm_source=share')?.embedUrl)
        .toBe('https://astralcodexten.substack.com/embed/p/some-post-slug');
      expect(matchEmbedService('https://my-pub.substack.com/p/hello-world/')?.embedUrl)
        .toBe('https://my-pub.substack.com/embed/p/hello-world');
    });

    it('does not match www/open hosts or non-post pages', () => {
      expect(matchEmbedService('https://www.substack.com/p/foo')).toBeNull();
      expect(matchEmbedService('https://open.substack.com/pub/astralcodexten/p/some-post-slug')).toBeNull();
      expect(matchEmbedService('https://astralcodexten.substack.com/about')).toBeNull();
      expect(matchEmbedService('https://astralcodexten.substack.com/archive')).toBeNull();
    });
  });

  describe('Threads URL variants', () => {
    it('flags Threads as a script embed and keeps the canonical post URL', () => {
      const result = matchEmbedService('https://www.threads.com/@zuck/post/C8z2Qq0Rk1x');

      expect(result?.service).toBe('threads');
      expect(result?.remoteId).toBe('@zuck/post/C8z2Qq0Rk1x');
      expect(result?.embedUrl).toBe('https://www.threads.com/@zuck/post/C8z2Qq0Rk1x');
      expect(result?.kind).toBe('script');
    });

    it('normalizes the threads.net mirror onto threads.com', () => {
      expect(matchEmbedService('https://www.threads.net/@zuck/post/C8z2Qq0Rk1x?xmt=AQGz')?.embedUrl)
        .toBe('https://www.threads.com/@zuck/post/C8z2Qq0Rk1x');
      expect(matchEmbedService('threads.net/@mosseri/post/DCxyz_-123')?.embedUrl)
        .toBe('https://www.threads.com/@mosseri/post/DCxyz_-123');
    });

    it('does not match profiles or lookalike hosts', () => {
      expect(matchEmbedService('https://www.threads.com/@zuck')).toBeNull();
      expect(matchEmbedService('https://notthreads.com/@zuck/post/C8z2Qq0Rk1x')).toBeNull();
    });
  });

  describe('TED URL variants', () => {
    it('matches a talk URL via the embed.ted.com host', () => {
      const result = matchEmbedService('https://www.ted.com/talks/amy_cuddy_your_body_language_may_shape_who_you_are');

      expect(result?.service).toBe('ted');
      expect(result?.embedUrl).toBe('https://embed.ted.com/talks/amy_cuddy_your_body_language_may_shape_who_you_are');
    });

    it('consumes language params and transcript sub-pages', () => {
      expect(matchEmbedService('https://www.ted.com/talks/sir_ken_robinson_do_schools_kill_creativity?language=es')?.embedUrl).toBe('https://embed.ted.com/talks/sir_ken_robinson_do_schools_kill_creativity');
      expect(matchEmbedService('https://www.ted.com/talks/sir_ken_robinson_do_schools_kill_creativity/transcript')?.embedUrl).toBe('https://embed.ted.com/talks/sir_ken_robinson_do_schools_kill_creativity');
    });

    it('does not match the bare /talks index or other site sections', () => {
      expect(matchEmbedService('https://www.ted.com/talks')).toBeNull();
      expect(matchEmbedService('https://www.ted.com/talks/')).toBeNull();
      expect(matchEmbedService('https://www.ted.com/speakers/amy_cuddy')).toBeNull();
    });
  });

  describe('Internet Archive URL variants', () => {
    it('matches a details URL via the /embed/ player', () => {
      const result = matchEmbedService('https://archive.org/details/BigBuckBunny_124');

      expect(result?.service).toBe('internetarchive');
      expect(result?.embedUrl).toBe('https://archive.org/embed/BigBuckBunny_124');
    });

    it('keeps only the item identifier from a deep file link', () => {
      expect(matchEmbedService('https://archive.org/details/night.of.the.living.dead_1968/night.of.the.living.dead.mp4')?.embedUrl).toBe('https://archive.org/embed/night.of.the.living.dead_1968');
    });

    it('matches an already-embed URL', () => {
      expect(matchEmbedService('https://archive.org/embed/BigBuckBunny_124')?.embedUrl).toBe('https://archive.org/embed/BigBuckBunny_124');
    });

    it('does not match non-item site pages', () => {
      expect(matchEmbedService('https://archive.org/details/')).toBeNull();
      expect(matchEmbedService('https://archive.org/about/')).toBeNull();
    });
  });

  describe('Kick URL variants', () => {
    it('matches a live channel URL via player.kick.com', () => {
      const result = matchEmbedService('https://kick.com/xqc');

      expect(result?.service).toBe('kick');
      expect(result?.embedUrl).toBe('https://player.kick.com/xqc?autoplay=false');
    });

    it('handles a trailing slash and query params', () => {
      expect(matchEmbedService('https://www.kick.com/trainwreckstv/')?.embedUrl).toBe('https://player.kick.com/trainwreckstv?autoplay=false');
      expect(matchEmbedService('https://kick.com/asmongold?followed=true')?.embedUrl).toBe('https://player.kick.com/asmongold?autoplay=false');
    });

    it('does not match reserved site paths', () => {
      expect(matchEmbedService('https://kick.com/browse')).toBeNull();
      expect(matchEmbedService('https://kick.com/categories')).toBeNull();
      expect(matchEmbedService('https://kick.com/category/just-chatting')).toBeNull();
      expect(matchEmbedService('https://kick.com/search?query=xqc')).toBeNull();
      expect(matchEmbedService('https://kick.com/community-guidelines')).toBeNull();
    });

    it('does not match VOD pages under a channel', () => {
      expect(matchEmbedService('https://kick.com/xqc/videos/abc-def-123')).toBeNull();
    });
  });

  describe('PeerTube URL variants', () => {
    it('matches a /w/ short link on an allowlisted instance', () => {
      const result = matchEmbedService('https://framatube.org/w/kkGMgK9ZtnKfYAgnEtQxbv');

      expect(result?.service).toBe('peertube');
      expect(result?.embedUrl).toBe('https://framatube.org/videos/embed/kkGMgK9ZtnKfYAgnEtQxbv');
    });

    it('matches a legacy /videos/watch/ UUID link', () => {
      expect(matchEmbedService('https://video.blender.org/videos/watch/9c9de5e8-0a1e-484a-b099-e80766180a6d')?.embedUrl).toBe('https://video.blender.org/videos/embed/9c9de5e8-0a1e-484a-b099-e80766180a6d');
    });

    it('matches the other allowlisted instances', () => {
      expect(matchEmbedService('https://tilvids.com/w/abc123XYZ?start=1m')?.embedUrl).toBe('https://tilvids.com/videos/embed/abc123XYZ');
      expect(matchEmbedService('https://makertube.net/w/abc123XYZ')?.embedUrl).toBe('https://makertube.net/videos/embed/abc123XYZ');
    });

    it('does not match unknown instances or non-video pages', () => {
      expect(matchEmbedService('https://someotherpeertube.example/w/abc123')).toBeNull();
      expect(matchEmbedService('https://framatube.org/videos/local')).toBeNull();
    });
  });

  describe('Odysee URL variants', () => {
    it('matches a channel + video claim path via $/embed', () => {
      const result = matchEmbedService('https://odysee.com/@samtime:1/apple-fans-react-to-vision-pro:0');

      expect(result?.service).toBe('odysee');
      expect(result?.embedUrl).toBe('https://odysee.com/$/embed/@samtime:1/apple-fans-react-to-vision-pro:0');
    });

    it('matches an anonymous claim path and consumes share params', () => {
      expect(matchEmbedService('https://odysee.com/what-is-odysee:6f7b8d9e')?.embedUrl).toBe('https://odysee.com/$/embed/what-is-odysee:6f7b8d9e');
      expect(matchEmbedService('https://odysee.com/@NafO:a/Odysee101:a?r=ABC')?.embedUrl).toBe('https://odysee.com/$/embed/@NafO:a/Odysee101:a');
    });

    it('decodes %3A-encoded colons in the claim path', () => {
      expect(matchEmbedService('https://odysee.com/what-is-odysee%3A6f7b8d9e')?.embedUrl).toBe('https://odysee.com/$/embed/what-is-odysee:6f7b8d9e');
    });

    it('does not match $/ app paths or channel-only URLs', () => {
      expect(matchEmbedService('https://odysee.com/$/invite/abc')).toBeNull();
      expect(matchEmbedService('https://odysee.com/$/embed/foo:1')).toBeNull();
      expect(matchEmbedService('https://odysee.com/@samtime:1')).toBeNull();
      expect(matchEmbedService('https://odysee.com/@samtime:1/')).toBeNull();
      expect(matchEmbedService('https://odysee.com/plainword')).toBeNull();
    });
  });

  describe('SOOP URL variants', () => {
    it('matches a sooplive.co.kr VOD and normalizes onto sooplive.com', () => {
      const result = matchEmbedService('https://vod.sooplive.co.kr/player/123456789');

      expect(result?.service).toBe('soop');
      expect(result?.embedUrl).toBe('https://vod.sooplive.com/player/123456789');
    });

    it('matches global and legacy afreecatv hosts', () => {
      expect(matchEmbedService('https://vod.sooplive.com/player/123456789?change_second=10')?.embedUrl).toBe('https://vod.sooplive.com/player/123456789');
      expect(matchEmbedService('https://vod.afreecatv.com/player/98765432')?.embedUrl).toBe('https://vod.sooplive.com/player/98765432');
    });

    it('does not match non-numeric ids or other soop hosts', () => {
      expect(matchEmbedService('https://vod.sooplive.com/player/notdigits')).toBeNull();
      expect(matchEmbedService('https://play.sooplive.co.kr/channelid')).toBeNull();
    });
  });

  describe('Coub URL variants', () => {
    it('matches a view URL via the /embed path', () => {
      const result = matchEmbedService('https://coub.com/view/1cmal');

      expect(result?.service).toBe('coub');
      expect(result?.embedUrl).toBe('https://coub.com/embed/1cmal');
    });

    it('consumes share params', () => {
      expect(matchEmbedService('https://coub.com/view/2pc24rpb?from=share')?.embedUrl).toBe('https://coub.com/embed/2pc24rpb');
    });

    it('does not match tag or listing pages', () => {
      expect(matchEmbedService('https://coub.com/view/')).toBeNull();
      expect(matchEmbedService('https://coub.com/tags/funny')).toBeNull();
    });
  });

  describe('BitChute URL variants', () => {
    it('matches a video URL via the /embed path', () => {
      const result = matchEmbedService('https://www.bitchute.com/video/UGlrf9d3vKHK/');

      expect(result?.service).toBe('bitchute');
      expect(result?.embedUrl).toBe('https://www.bitchute.com/embed/UGlrf9d3vKHK/');
    });

    it('matches ids containing hyphens and underscores without a trailing slash', () => {
      expect(matchEmbedService('https://bitchute.com/video/some-id_OK')?.embedUrl).toBe('https://www.bitchute.com/embed/some-id_OK/');
    });

    it('does not match channel pages or the bare video path', () => {
      expect(matchEmbedService('https://www.bitchute.com/channel/someone/')).toBeNull();
      expect(matchEmbedService('https://www.bitchute.com/video/')).toBeNull();
    });
  });

  describe('Tidal URL variants', () => {
    it('matches a browse track URL and pluralizes the type segment', () => {
      const result = matchEmbedService('https://tidal.com/browse/track/46757219');

      expect(result?.service).toBe('tidal');
      expect(result?.embedUrl).toBe('https://embed.tidal.com/tracks/46757219');
    });

    it('matches listen.tidal.com and browse-less album links', () => {
      expect(matchEmbedService('https://listen.tidal.com/album/79925210')?.embedUrl)
        .toBe('https://embed.tidal.com/albums/79925210');
      expect(matchEmbedService('https://tidal.com/album/79925210')?.embedUrl)
        .toBe('https://embed.tidal.com/albums/79925210');
    });

    it('matches UUID playlist and video links', () => {
      expect(matchEmbedService('https://tidal.com/browse/playlist/55b2c563-a238-4ebf-9a45-284fc5fa1e44')?.embedUrl)
        .toBe('https://embed.tidal.com/playlists/55b2c563-a238-4ebf-9a45-284fc5fa1e44');
      expect(matchEmbedService('https://tidal.com/browse/video/123456789')?.embedUrl)
        .toBe('https://embed.tidal.com/videos/123456789');
    });

    it('does not match mix or artist pages (no verified embed mapping)', () => {
      expect(matchEmbedService('https://tidal.com/browse/mix/0144d8b1a72f51c4f6f30e9b8b1a1e')).toBeNull();
      expect(matchEmbedService('https://tidal.com/browse/artist/3503597')).toBeNull();
    });
  });

  describe('Spotify for Creators URL variants', () => {
    it('matches a creators.spotify.com episode and inserts /embed before /episodes', () => {
      const result = matchEmbedService('https://creators.spotify.com/pod/show/myshow/episodes/Ep-Title-e2abc1d');

      expect(result?.service).toBe('spotifypodcasters');
      expect(result?.embedUrl).toBe('https://creators.spotify.com/pod/show/myshow/embed/episodes/Ep-Title-e2abc1d');
    });

    it('matches legacy podcasters.spotify.com and anchor.fm hosts', () => {
      expect(matchEmbedService('https://podcasters.spotify.com/pod/show/myshow/episodes/Ep-Title-e2abc1d')?.embedUrl)
        .toBe('https://creators.spotify.com/pod/show/myshow/embed/episodes/Ep-Title-e2abc1d');
      expect(matchEmbedService('https://anchor.fm/myshow/episodes/Ep-Title-e2abc1d')?.embedUrl)
        .toBe('https://creators.spotify.com/pod/show/myshow/embed/episodes/Ep-Title-e2abc1d');
    });

    it('does not match bare show pages', () => {
      expect(matchEmbedService('https://creators.spotify.com/pod/show/myshow')).toBeNull();
    });

    it('still routes open.spotify.com URLs to the spotify entry', () => {
      expect(matchEmbedService('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT')?.service).toBe('spotify');
      expect(matchEmbedService('https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk')?.service).toBe('spotify');
    });
  });

  describe('Pocket Casts URL variants', () => {
    it('matches a share code via the /embed/ path', () => {
      const result = matchEmbedService('https://pca.st/itl5093f');

      expect(result?.service).toBe('pocketcasts');
      expect(result?.embedUrl).toBe('https://pca.st/embed/itl5093f');
    });

    it('does not match reserved site pages', () => {
      expect(matchEmbedService('https://pca.st/discover')).toBeNull();
      expect(matchEmbedService('https://pca.st/podcasts')).toBeNull();
      expect(matchEmbedService('https://pca.st/sign-in')).toBeNull();
      expect(matchEmbedService('https://pca.st/podcast/abc123')).toBeNull();
    });
  });

  describe('iHeart URL variants', () => {
    it('matches a podcast show page and appends ?embed=true', () => {
      const result = matchEmbedService('https://www.iheart.com/podcast/105-stuff-you-should-know-26940277/');

      expect(result?.service).toBe('iheart');
      expect(result?.embedUrl).toBe('https://www.iheart.com/podcast/105-stuff-you-should-know-26940277/?embed=true');
    });

    it('matches episode and live-station pages', () => {
      expect(matchEmbedService('https://www.iheart.com/podcast/105-stuff-you-should-know-26940277/episode/selects-how-crime-scene-cleanup-118729610/')?.embedUrl)
        .toBe('https://www.iheart.com/podcast/105-stuff-you-should-know-26940277/episode/selects-how-crime-scene-cleanup-118729610/?embed=true');
      expect(matchEmbedService('https://www.iheart.com/live/z100-1469/')?.embedUrl)
        .toBe('https://www.iheart.com/live/z100-1469/?embed=true');
    });

    it('does not match artist or listing pages', () => {
      expect(matchEmbedService('https://www.iheart.com/artist/drake-31061/')).toBeNull();
      expect(matchEmbedService('https://www.iheart.com/podcast/')).toBeNull();
    });
  });

  describe('Acast URL variants', () => {
    it('matches an episode URL and drops the /episodes/ segment in the embed', () => {
      const result = matchEmbedService('https://shows.acast.com/dansnowshistoryhit/episodes/the-battle-of-britain');

      expect(result?.service).toBe('acast');
      expect(result?.embedUrl).toBe('https://embed.acast.com/dansnowshistoryhit/the-battle-of-britain');
    });

    it('matches older episode links without /episodes/', () => {
      expect(matchEmbedService('https://shows.acast.com/dansnowshistoryhit/the-battle-of-britain')?.embedUrl)
        .toBe('https://embed.acast.com/dansnowshistoryhit/the-battle-of-britain');
    });

    it('does not match show pages or the episodes listing', () => {
      expect(matchEmbedService('https://shows.acast.com/dansnowshistoryhit')).toBeNull();
      expect(matchEmbedService('https://shows.acast.com/dansnowshistoryhit/episodes')).toBeNull();
    });
  });

  describe('Podbean URL variants', () => {
    it('matches an /ew/ share link and rearranges the key for the player-v2 widget', () => {
      const result = matchEmbedService('https://www.podbean.com/ew/pb-k3gmv-14a8e2b');

      expect(result?.service).toBe('podbean');
      expect(result?.embedUrl).toBe('https://www.podbean.com/player-v2/?i=k3gmv-14a8e2b-pb');
    });

    it('does not match per-show subdomain episode pages', () => {
      expect(matchEmbedService('https://myshow.podbean.com/e/episode-title/')).toBeNull();
    });
  });

  describe('Spreaker URL variants', () => {
    it('matches a slug URL and extracts the trailing numeric id', () => {
      const result = matchEmbedService('https://www.spreaker.com/episode/the-best-episode-ever--58444864');

      expect(result?.service).toBe('spreaker');
      expect(result?.embedUrl).toBe('https://widget.spreaker.com/player?episode_id=58444864');
    });

    it('matches legacy numeric-only episode links', () => {
      expect(matchEmbedService('https://www.spreaker.com/episode/58444864')?.embedUrl)
        .toBe('https://widget.spreaker.com/player?episode_id=58444864');
    });

    it('does not match show pages or slug-only links', () => {
      expect(matchEmbedService('https://www.spreaker.com/podcast/my-show--5644222')).toBeNull();
      expect(matchEmbedService('https://www.spreaker.com/episode/slug-no-id')).toBeNull();
    });
  });

  describe('Buzzsprout URL variants', () => {
    it('matches an episode URL and appends the small-player query', () => {
      const result = matchEmbedService('https://www.buzzsprout.com/1121972/episodes/15967567-our-best-episode');

      expect(result?.service).toBe('buzzsprout');
      expect(result?.embedUrl).toBe('https://www.buzzsprout.com/1121972/episodes/15967567-our-best-episode?client_source=small_player&iframe=true');
    });

    it('matches older links without /episodes/ or without a slug', () => {
      expect(matchEmbedService('https://www.buzzsprout.com/1121972/15967567-our-best-episode')?.embedUrl)
        .toBe('https://www.buzzsprout.com/1121972/15967567-our-best-episode?client_source=small_player&iframe=true');
      expect(matchEmbedService('https://www.buzzsprout.com/1121972/episodes/15967567')?.embedUrl)
        .toBe('https://www.buzzsprout.com/1121972/episodes/15967567?client_source=small_player&iframe=true');
    });

    it('does not match podcast home or site pages', () => {
      expect(matchEmbedService('https://www.buzzsprout.com/1121972')).toBeNull();
      expect(matchEmbedService('https://www.buzzsprout.com/pricing')).toBeNull();
    });
  });

  describe('Castbox URL variants', () => {
    it('matches an episode URL and extracts the trailing channel/episode id pair', () => {
      const result = matchEmbedService('https://castbox.fm/episode/Ep.-100%3A-The-Finale-id1234567-id987654321?country=us');

      expect(result?.service).toBe('castbox');
      expect(result?.embedUrl).toBe('https://castbox.fm/app/castbox/player/id1234567/id987654321?v=8.22.11&autoplay=0');
    });

    it('matches a channel URL with a single id', () => {
      expect(matchEmbedService('https://castbox.fm/channel/The-Daily-id4525925')?.embedUrl)
        .toBe('https://castbox.fm/app/castbox/player/id4525925?v=8.22.11&autoplay=0');
    });

    it('takes the trailing id pair when the slug itself contains -idN tokens', () => {
      expect(matchEmbedService('https://castbox.fm/episode/weird-id1-id2-id345-id678')?.embedUrl)
        .toBe('https://castbox.fm/app/castbox/player/id345/id678?v=8.22.11&autoplay=0');
    });

    it('does not match id-less episode URLs or site pages', () => {
      expect(matchEmbedService('https://castbox.fm/episode/no-ids-here')).toBeNull();
      expect(matchEmbedService('https://castbox.fm/home')).toBeNull();
    });
  });

  describe('Transistor URL variants', () => {
    it('rewrites a share /s/ page onto the frameable /e/ player', () => {
      const result = matchEmbedService('https://share.transistor.fm/s/9b4dde55');

      expect(result?.service).toBe('transistor');
      expect(result?.embedUrl).toBe('https://share.transistor.fm/e/9b4dde55');
    });

    it('matches an already-embed /e/ URL', () => {
      expect(matchEmbedService('https://share.transistor.fm/e/9b4dde55')?.embedUrl)
        .toBe('https://share.transistor.fm/e/9b4dde55');
    });

    it('does not match the marketing site', () => {
      expect(matchEmbedService('https://transistor.fm/features/')).toBeNull();
    });
  });

  describe('Audioboom URL variants', () => {
    it('matches a post URL via the v4 embed', () => {
      const result = matchEmbedService('https://audioboom.com/posts/8730423-our-great-episode');

      expect(result?.service).toBe('audioboom');
      expect(result?.embedUrl).toBe('https://embeds.audioboom.com/posts/8730423/embed/v4');
    });

    it('does not match channel pages', () => {
      expect(matchEmbedService('https://audioboom.com/channels/5025217')).toBeNull();
    });
  });

  describe('TuneIn URL variants', () => {
    it('matches a station URL and extracts the s-id', () => {
      const result = matchEmbedService('https://tunein.com/radio/Jazz24-s34682/');

      expect(result?.service).toBe('tunein');
      expect(result?.embedUrl).toBe('https://tunein.com/embed/player/s34682/');
    });

    it('does not match podcast/program (p-id) pages', () => {
      expect(matchEmbedService('https://tunein.com/podcasts/News--Politics/The-Daily-p1001329/')).toBeNull();
      expect(matchEmbedService('https://tunein.com/radio/home/')).toBeNull();
    });
  });

  describe('Beatport URL variants', () => {
    it('matches a track URL via the embed player query', () => {
      const result = matchEmbedService('https://www.beatport.com/track/strobe/1696999');

      expect(result?.service).toBe('beatport');
      expect(result?.embedUrl).toBe('https://embed.beatport.com/?id=1696999&type=track');
    });

    it('does not match releases or id-less track URLs', () => {
      expect(matchEmbedService('https://www.beatport.com/release/some-release/1234567')).toBeNull();
      expect(matchEmbedService('https://www.beatport.com/track/strobe')).toBeNull();
    });
  });

  describe('NetEase Music URL variants', () => {
    it('matches a song URL via the outchain player', () => {
      const result = matchEmbedService('https://music.163.com/song?id=347230');

      expect(result?.service).toBe('netease');
      expect(result?.embedUrl).toBe('https://music.163.com/outchain/player?type=2&id=347230&auto=0&height=66');
    });

    it('matches the SPA hash form and non-leading id params', () => {
      expect(matchEmbedService('https://music.163.com/#/song?id=347230&userid=1')?.embedUrl)
        .toBe('https://music.163.com/outchain/player?type=2&id=347230&auto=0&height=66');
      expect(matchEmbedService('music.163.com/#/song?userid=1&id=347230')?.embedUrl)
        .toBe('https://music.163.com/outchain/player?type=2&id=347230&auto=0&height=66');
    });

    it('does not match album or playlist hash routes', () => {
      expect(matchEmbedService('https://music.163.com/#/album?id=34209')).toBeNull();
      expect(matchEmbedService('https://music.163.com/#/playlist?id=2884035')).toBeNull();
    });
  });

  describe('Suno URL variants', () => {
    it('matches a song UUID URL via the /embed/ path', () => {
      const result = matchEmbedService('https://suno.com/song/df9e2bc9-8e2e-4b9a-a1c3-0123456789ab');

      expect(result?.service).toBe('suno');
      expect(result?.embedUrl).toBe('https://suno.com/embed/df9e2bc9-8e2e-4b9a-a1c3-0123456789ab');
    });

    it('does not match playlists or non-UUID song paths', () => {
      expect(matchEmbedService('https://suno.com/playlist/df9e2bc9-8e2e-4b9a-a1c3-0123456789ab')).toBeNull();
      expect(matchEmbedService('https://suno.com/song/not-a-uuid')).toBeNull();
    });
  });

  describe('hearthis.at URL variants', () => {
    it('matches a track URL and appends /embed/', () => {
      const result = matchEmbedService('https://hearthis.at/djmix/summer-session-2024/');

      expect(result?.service).toBe('hearthis');
      expect(result?.embedUrl).toBe('https://hearthis.at/djmix/summer-session-2024/embed/');
    });

    it('does not match profile pages or reserved site sections', () => {
      expect(matchEmbedService('https://hearthis.at/djmix/')).toBeNull();
      expect(matchEmbedService('https://hearthis.at/categories/drumandbass/')).toBeNull();
      expect(matchEmbedService('https://hearthis.at/charts/week/')).toBeNull();
      expect(matchEmbedService('https://hearthis.at/search/?t=jazz')).toBeNull();
      expect(matchEmbedService('https://hearthis.at/pages/imprint/')).toBeNull();
      expect(matchEmbedService('https://hearthis.at/set/user/myset/')).toBeNull();
    });
  });

  describe('Boomplay URL variants', () => {
    it('matches a song URL via the /embed/<id>/MUSIC player', () => {
      const result = matchEmbedService('https://www.boomplay.com/songs/129188941?srModel=COPYLINK');

      expect(result?.service).toBe('boomplay');
      expect(result?.embedUrl).toBe('https://www.boomplay.com/embed/129188941/MUSIC');
    });

    it('does not match album or artist pages', () => {
      expect(matchEmbedService('https://www.boomplay.com/albums/12345678')).toBeNull();
      expect(matchEmbedService('https://www.boomplay.com/artists/1234')).toBeNull();
    });
  });

  describe('Calendly URL variants', () => {
    it('matches a scheduling page and appends the inline-embed params', () => {
      const result = matchEmbedService('https://calendly.com/acme-team');

      expect(result?.service).toBe('calendly');
      expect(result?.embedUrl).toBe('https://calendly.com/acme-team?embed_domain=blok&embed_type=Inline');
    });

    it('matches an event-type page and strips share query params', () => {
      const result = matchEmbedService('https://calendly.com/acme-team/30min?month=2026-06');

      expect(result?.embedUrl).toBe('https://calendly.com/acme-team/30min?embed_domain=blok&embed_type=Inline');
    });

    it('matches a one-off /d/<code>/<slug> link', () => {
      const result = matchEmbedService('https://calendly.com/d/cmgh-3xb/intro-call');

      expect(result?.embedUrl).toBe('https://calendly.com/d/cmgh-3xb/intro-call?embed_domain=blok&embed_type=Inline');
    });

    it('does not match reserved site sections', () => {
      expect(matchEmbedService('https://calendly.com/pricing')).toBeNull();
      expect(matchEmbedService('https://calendly.com/features')).toBeNull();
      expect(matchEmbedService('https://calendly.com/app/login')).toBeNull();
      expect(matchEmbedService('https://calendly.com/event_types/user/me')).toBeNull();
      expect(matchEmbedService('https://calendly.com/blog')).toBeNull();
    });

    it('does not match lookalike or nested hosts', () => {
      expect(matchEmbedService('https://notcalendly.com/acme-team')).toBeNull();
      expect(matchEmbedService('https://example.com/calendly.com/acme')).toBeNull();
    });
  });

  describe('Tally URL variants', () => {
    it('matches a share /r/ link via the embed endpoint', () => {
      const result = matchEmbedService('https://tally.so/r/wMNDgn');

      expect(result?.service).toBe('tally');
      expect(result?.embedUrl).toBe('https://tally.so/embed/wMNDgn');
    });

    it('matches a pasted embed URL and strips widget params', () => {
      expect(matchEmbedService('https://tally.so/embed/wMNDgn?alignLeft=1')?.embedUrl).toBe('https://tally.so/embed/wMNDgn');
    });

    it('does not match site pages', () => {
      expect(matchEmbedService('https://tally.so/templates')).toBeNull();
      expect(matchEmbedService('https://tally.so/')).toBeNull();
    });
  });

  describe('JotForm URL variants', () => {
    it('matches a form.jotform.com link', () => {
      const result = matchEmbedService('https://form.jotform.com/241234567890123');

      expect(result?.service).toBe('jotform');
      expect(result?.embedUrl).toBe('https://form.jotform.com/241234567890123');
    });

    it('normalizes www and eu hosts onto form.jotform.com', () => {
      expect(matchEmbedService('https://www.jotform.com/241234567890123')?.embedUrl).toBe('https://form.jotform.com/241234567890123');
      expect(matchEmbedService('https://eu.jotform.com/241234567890123')?.embedUrl).toBe('https://form.jotform.com/241234567890123');
    });

    it('does not match slug-based forms or site pages', () => {
      expect(matchEmbedService('https://form.jotform.com/my-cool-form')).toBeNull();
      expect(matchEmbedService('https://www.jotform.com/form-templates/registration')).toBeNull();
      expect(matchEmbedService('https://www.jotform.com/myforms')).toBeNull();
    });
  });

  describe('Whimsical URL variants', () => {
    it('matches a slugged board URL and extracts the trailing token', () => {
      const result = matchEmbedService('https://whimsical.com/my-roadmap-Q3xL9mTzKvB2aWcRpD8uHn');

      expect(result?.service).toBe('whimsical');
      expect(result?.embedUrl).toBe('https://whimsical.com/embed/Q3xL9mTzKvB2aWcRpD8uHn');
    });

    it('matches a bare-token URL and strips share query params', () => {
      expect(matchEmbedService('https://whimsical.com/Q3xL9mTzKvB2aWcRpD8uHn')?.embedUrl).toBe('https://whimsical.com/embed/Q3xL9mTzKvB2aWcRpD8uHn');
      expect(matchEmbedService('https://whimsical.com/roadmap-Q3xL9mTzKvB2aWcRpD8uHn?from=share')?.embedUrl).toBe('https://whimsical.com/embed/Q3xL9mTzKvB2aWcRpD8uHn');
    });

    it('does not match marketing pages or short non-token slugs', () => {
      expect(matchEmbedService('https://whimsical.com/mind-maps')).toBeNull();
      expect(matchEmbedService('https://whimsical.com/templates')).toBeNull();
      expect(matchEmbedService('https://whimsical.com/pricing')).toBeNull();
      expect(matchEmbedService('https://whimsical.com/blog')).toBeNull();
      expect(matchEmbedService('https://whimsical.com/short-Ab1')).toBeNull();
    });
  });

  describe('Excalidraw URL variants', () => {
    it('passes a #json= share link through with its doc id and key', () => {
      const result = matchEmbedService('https://excalidraw.com/#json=AbC123dEf456GhI789jK,XyZ987wVu654TsR321qP');

      expect(result?.service).toBe('excalidraw');
      expect(result?.embedUrl).toBe('https://excalidraw.com/#json=AbC123dEf456GhI789jK,XyZ987wVu654TsR321qP');
    });

    it('does not match #room= collab sessions or the bare app', () => {
      expect(matchEmbedService('https://excalidraw.com/#room=abc123def456,XyZ987wVu654TsR321qP')).toBeNull();
      expect(matchEmbedService('https://excalidraw.com/')).toBeNull();
    });
  });

  describe('tldraw URL variants', () => {
    it('matches a room link and keeps the kind segment', () => {
      const result = matchEmbedService('https://www.tldraw.com/r/AbCdEf123456');

      expect(result?.service).toBe('tldraw');
      expect(result?.embedUrl).toBe('https://www.tldraw.com/r/AbCdEf123456');
    });

    it('matches read-only, snapshot and published links', () => {
      expect(matchEmbedService('https://tldraw.com/ro/AbCdEf123456')?.embedUrl).toBe('https://www.tldraw.com/ro/AbCdEf123456');
      expect(matchEmbedService('https://www.tldraw.com/v/AbCdEf123456?d=v123')?.embedUrl).toBe('https://www.tldraw.com/v/AbCdEf123456');
      expect(matchEmbedService('https://www.tldraw.com/p/AbCdEf123456')?.embedUrl).toBe('https://www.tldraw.com/p/AbCdEf123456');
    });

    it('does not match auth-only /f/ file links', () => {
      expect(matchEmbedService('https://www.tldraw.com/f/AbCdEf123456')).toBeNull();
    });
  });

  describe('Mentimeter URL variants', () => {
    it('matches a presentation link via the /embed viewer', () => {
      const result = matchEmbedService('https://www.mentimeter.com/app/presentation/alxyz1u2abcdefg');

      expect(result?.service).toBe('mentimeter');
      expect(result?.embedUrl).toBe('https://www.mentimeter.com/app/presentation/alxyz1u2abcdefg/embed');
    });

    it('drops a trailing slide id (embed plays the whole deck)', () => {
      expect(matchEmbedService('https://www.mentimeter.com/app/presentation/alxyz1u2abcdefg/slide123')?.embedUrl)
        .toBe('https://www.mentimeter.com/app/presentation/alxyz1u2abcdefg/embed');
    });

    it('does not match menti.com voting codes or site pages', () => {
      expect(matchEmbedService('https://www.menti.com/alxyz1u2abcd')).toBeNull();
      expect(matchEmbedService('https://www.mentimeter.com/templates')).toBeNull();
    });
  });

  describe('Behance URL variants', () => {
    it('matches a project gallery URL via the embed/project endpoint', () => {
      const result = matchEmbedService('https://www.behance.net/gallery/123456789/Brand-Identity');

      expect(result?.service).toBe('behance');
      expect(result?.embedUrl).toBe('https://www.behance.net/embed/project/123456789');
    });

    it('strips tracking query params', () => {
      expect(matchEmbedService('https://behance.net/gallery/123456789/Brand-Identity?tracking_source=search')?.embedUrl)
        .toBe('https://www.behance.net/embed/project/123456789');
    });

    it('does not match listing or profile pages', () => {
      expect(matchEmbedService('https://www.behance.net/galleries/graphic-design')).toBeNull();
      expect(matchEmbedService('https://www.behance.net/someuser')).toBeNull();
    });
  });

  describe('Chromatic URL variants', () => {
    it('rebuilds a story permalink onto the iframe.html endpoint', () => {
      const result = matchEmbedService('https://5ccbc373887ca40020446347-abcdef.chromatic.com/?path=/story/button--primary');

      expect(result?.service).toBe('chromatic');
      expect(result?.embedUrl).toBe('https://5ccbc373887ca40020446347-abcdef.chromatic.com/iframe.html?id=button--primary&viewMode=story');
    });

    it('uses viewMode=docs for docs paths', () => {
      expect(matchEmbedService('https://main--abc123.chromatic.com/?path=/docs/button--docs')?.embedUrl)
        .toBe('https://main--abc123.chromatic.com/iframe.html?id=button--docs&viewMode=docs');
    });

    it('finds path= among other query params', () => {
      expect(matchEmbedService('https://main--abc123.chromatic.com/?foo=1&path=/story/button--primary&bar=2')?.embedUrl)
        .toBe('https://main--abc123.chromatic.com/iframe.html?id=button--primary&viewMode=story');
    });

    it('does not match bare build roots or the marketing site', () => {
      expect(matchEmbedService('https://abc123.chromatic.com/')).toBeNull();
      expect(matchEmbedService('https://www.chromatic.com/builds?appId=123')).toBeNull();
    });
  });

  describe('Plunker URL variants', () => {
    it('matches an editor URL via the embed host with preview', () => {
      const result = matchEmbedService('https://plnkr.co/edit/abc123XYZ');

      expect(result?.service).toBe('plunker');
      expect(result?.embedUrl).toBe('https://embed.plnkr.co/abc123XYZ?show=preview');
    });

    it('matches plunk share and direct embed-host URLs', () => {
      expect(matchEmbedService('https://plnkr.co/plunk/abc123XYZ')?.embedUrl).toBe('https://embed.plnkr.co/abc123XYZ?show=preview');
      expect(matchEmbedService('https://embed.plnkr.co/abc123XYZ?show=preview')?.embedUrl).toBe('https://embed.plnkr.co/abc123XYZ?show=preview');
    });

    it('does not match the site root', () => {
      expect(matchEmbedService('https://plnkr.co/')).toBeNull();
    });
  });

  describe('Datawrapper URL variants', () => {
    it('matches a dwcdn chart URL and drops the version segment', () => {
      const result = matchEmbedService('https://datawrapper.dwcdn.net/OhYbA/4/');

      expect(result?.service).toBe('datawrapper');
      expect(result?.embedUrl).toBe('https://datawrapper.dwcdn.net/OhYbA/');
    });

    it('matches a www.datawrapper.de/_/ share link', () => {
      expect(matchEmbedService('https://www.datawrapper.de/_/OhYbA/')?.embedUrl)
        .toBe('https://datawrapper.dwcdn.net/OhYbA/');
    });

    it('does not match site pages or non-5-char ids', () => {
      expect(matchEmbedService('https://www.datawrapper.de/pricing')).toBeNull();
      expect(matchEmbedService('https://www.datawrapper.de/')).toBeNull();
      expect(matchEmbedService('https://datawrapper.dwcdn.net/toolong/')).toBeNull();
    });
  });

  describe('Flourish URL variants', () => {
    it('matches a visualisation URL via the flo.uri.sh embed host', () => {
      const result = matchEmbedService('https://public.flourish.studio/visualisation/1234567/');

      expect(result?.service).toBe('flourish');
      expect(result?.embedUrl).toBe('https://flo.uri.sh/visualisation/1234567/embed');
    });

    it('matches a story URL', () => {
      expect(matchEmbedService('https://public.flourish.studio/story/123456/')?.embedUrl)
        .toBe('https://flo.uri.sh/story/123456/embed');
    });

    it('does not match the bare host or marketing pages', () => {
      expect(matchEmbedService('https://public.flourish.studio/')).toBeNull();
      expect(matchEmbedService('https://flourish.studio/examples/')).toBeNull();
    });
  });

  describe('Our World in Data URL variants', () => {
    it('matches a grapher URL preserving chart-state query params', () => {
      const result = matchEmbedService('https://ourworldindata.org/grapher/life-expectancy?tab=chart&country=~USA');

      expect(result?.service).toBe('ourworldindata');
      expect(result?.embedUrl).toBe('https://ourworldindata.org/grapher/life-expectancy?tab=chart&country=~USA');
    });

    it('matches an explorer URL', () => {
      expect(matchEmbedService('https://ourworldindata.org/explorers/migration?facet=none&country=USA~GBR')?.embedUrl)
        .toBe('https://ourworldindata.org/explorers/migration?facet=none&country=USA~GBR');
    });

    it('does not match article pages or the bare host', () => {
      expect(matchEmbedService('https://ourworldindata.org/covid-deaths')).toBeNull();
      expect(matchEmbedService('https://ourworldindata.org/')).toBeNull();
    });
  });

  describe('GeoGebra URL variants', () => {
    it('matches a material (/m/) URL as a passthrough', () => {
      const result = matchEmbedService('https://www.geogebra.org/m/cAsHWvWS');

      expect(result?.service).toBe('geogebra');
      expect(result?.embedUrl).toBe('https://www.geogebra.org/m/cAsHWvWS');
    });

    it('matches calculator and classic URLs', () => {
      expect(matchEmbedService('https://geogebra.org/calculator/nbjqsducc')?.embedUrl)
        .toBe('https://www.geogebra.org/calculator/nbjqsducc');
      expect(matchEmbedService('https://www.geogebra.org/classic/qcfwqupe')?.embedUrl)
        .toBe('https://www.geogebra.org/classic/qcfwqupe');
    });

    it('does not match site pages', () => {
      expect(matchEmbedService('https://www.geogebra.org/download')).toBeNull();
      expect(matchEmbedService('https://www.geogebra.org/')).toBeNull();
    });
  });

  describe('Scratch URL variants', () => {
    it('matches a project URL via the /embed player', () => {
      const result = matchEmbedService('https://scratch.mit.edu/projects/1090231983/');

      expect(result?.service).toBe('scratch');
      expect(result?.embedUrl).toBe('https://scratch.mit.edu/projects/1090231983/embed');
    });

    it('matches a project editor URL', () => {
      expect(matchEmbedService('https://scratch.mit.edu/projects/1090231983/editor/')?.embedUrl)
        .toBe('https://scratch.mit.edu/projects/1090231983/embed');
    });

    it('does not match studios or the bare editor', () => {
      expect(matchEmbedService('https://scratch.mit.edu/studios/27205657/')).toBeNull();
      expect(matchEmbedService('https://scratch.mit.edu/projects/editor/')).toBeNull();
    });
  });

  describe('Kahoot URL variants', () => {
    it('matches a details URL via the embed host', () => {
      const result = matchEmbedService('https://create.kahoot.it/details/965a7a4f-1c81-4d63-a2db-1a4d8f1e0f12');

      expect(result?.service).toBe('kahoot');
      expect(result?.embedUrl).toBe('https://embed.kahoot.it/965a7a4f-1c81-4d63-a2db-1a4d8f1e0f12');
    });

    it('matches a share URL with a slug segment', () => {
      expect(matchEmbedService('https://create.kahoot.it/share/science-quiz/965a7a4f-1c81-4d63-a2db-1a4d8f1e0f12')?.embedUrl)
        .toBe('https://embed.kahoot.it/965a7a4f-1c81-4d63-a2db-1a4d8f1e0f12');
    });

    it('does not match challenge links or non-UUID paths', () => {
      expect(matchEmbedService('https://kahoot.it/challenge/0857294')).toBeNull();
      expect(matchEmbedService('https://create.kahoot.it/details/not-a-uuid')).toBeNull();
    });
  });

  describe('Genially URL variants', () => {
    it('matches a view URL and drops the slug tail', () => {
      const result = matchEmbedService('https://view.genially.com/64fb1c8a2d3e4f0011aabbcc/interactive-image');

      expect(result?.service).toBe('genially');
      expect(result?.embedUrl).toBe('https://view.genially.com/64fb1c8a2d3e4f0011aabbcc');
    });

    it('matches the legacy view.genial.ly domain', () => {
      expect(matchEmbedService('https://view.genial.ly/64fb1c8a2d3e4f0011aabbcc')?.embedUrl)
        .toBe('https://view.genially.com/64fb1c8a2d3e4f0011aabbcc');
    });

    it('does not match editor links or non-24-hex ids', () => {
      expect(matchEmbedService('https://app.genially.com/editor/64fb1c8a2d3e4f0011aabbcc')).toBeNull();
      expect(matchEmbedService('https://view.genially.com/short')).toBeNull();
    });
  });

  describe('Infogram URL variants', () => {
    it('matches a project URL keeping the full slug', () => {
      const result = matchEmbedService('https://infogram.com/monthly-report-1h7g6k0e9q5o2oy');

      expect(result?.service).toBe('infogram');
      expect(result?.embedUrl).toBe('https://e.infogram.com/monthly-report-1h7g6k0e9q5o2oy?src=embed');
    });

    it('does not match reserved site paths', () => {
      expect(matchEmbedService('https://infogram.com/blog')).toBeNull();
      expect(matchEmbedService('https://infogram.com/pricing')).toBeNull();
      expect(matchEmbedService('https://infogram.com/templates/charts')).toBeNull();
    });

    it('does not match multi-segment paths or the bare host', () => {
      expect(matchEmbedService('https://infogram.com/user/some-chart-1h7g6k0e9q5o2oy')).toBeNull();
      expect(matchEmbedService('https://infogram.com/')).toBeNull();
    });
  });

  describe('ArcGIS StoryMaps URL variants', () => {
    it('matches a story URL as a passthrough', () => {
      const result = matchEmbedService('https://storymaps.arcgis.com/stories/0123456789abcdef0123456789abcdef');

      expect(result?.service).toBe('arcgisstorymaps');
      expect(result?.embedUrl).toBe('https://storymaps.arcgis.com/stories/0123456789abcdef0123456789abcdef');
    });

    it('matches a collection URL and strips query params', () => {
      expect(matchEmbedService('https://storymaps.arcgis.com/collections/abcdefabcdefabcdefabcdefabcdef12?item=2')?.embedUrl)
        .toBe('https://storymaps.arcgis.com/collections/abcdefabcdefabcdefabcdefabcdef12');
    });

    it('does not match listing pages or the bare host', () => {
      expect(matchEmbedService('https://storymaps.arcgis.com/stories')).toBeNull();
      expect(matchEmbedService('https://storymaps.arcgis.com/')).toBeNull();
    });
  });

  describe('Felt URL variants', () => {
    it('matches a map share URL via the /embed/map/ path', () => {
      const result = matchEmbedService('https://felt.com/map/My-Cool-Map-9BCQglnQTleNJxRhmJWUDCA');

      expect(result?.service).toBe('felt');
      expect(result?.embedUrl).toBe('https://felt.com/embed/map/My-Cool-Map-9BCQglnQTleNJxRhmJWUDCA');
    });

    it('matches an already-embed URL', () => {
      expect(matchEmbedService('https://felt.com/embed/map/My-Cool-Map-9BCQglnQTleNJxRhmJWUDCA')?.embedUrl)
        .toBe('https://felt.com/embed/map/My-Cool-Map-9BCQglnQTleNJxRhmJWUDCA');
    });

    it('does not match site pages or the bare host', () => {
      expect(matchEmbedService('https://felt.com/pricing')).toBeNull();
      expect(matchEmbedService('https://felt.com/')).toBeNull();
    });
  });

  describe('p5.js editor URL variants', () => {
    it('matches a sketch URL via the chrome-less /full/ view', () => {
      const result = matchEmbedService('https://editor.p5js.org/p5/sketches/Hk7tg4q7l');

      expect(result?.service).toBe('p5js');
      expect(result?.embedUrl).toBe('https://editor.p5js.org/p5/full/Hk7tg4q7l');
    });

    it('matches full, embed and present variants', () => {
      expect(matchEmbedService('https://editor.p5js.org/jane.doe/full/Hk7tg4q7l')?.embedUrl)
        .toBe('https://editor.p5js.org/jane.doe/full/Hk7tg4q7l');
      expect(matchEmbedService('https://editor.p5js.org/p5/embed/Hk7tg4q7l')?.embedUrl)
        .toBe('https://editor.p5js.org/p5/full/Hk7tg4q7l');
      expect(matchEmbedService('https://editor.p5js.org/p5/present/Hk7tg4q7l')?.embedUrl)
        .toBe('https://editor.p5js.org/p5/full/Hk7tg4q7l');
    });

    it('does not match collections or sketch listings', () => {
      expect(matchEmbedService('https://editor.p5js.org/p5/collections/abc')).toBeNull();
      expect(matchEmbedService('https://editor.p5js.org/p5/sketches')).toBeNull();
    });
  });

  describe('Wakelet URL variants', () => {
    it('matches a wake URL via the embed list view', () => {
      const result = matchEmbedService('https://wakelet.com/wake/4t7Vy9hDFLbacQHRSrSmVA');

      expect(result?.service).toBe('wakelet');
      expect(result?.embedUrl).toBe('https://embed.wakelet.com/wakes/4t7Vy9hDFLbacQHRSrSmVA/list');
    });

    it('does not match profile pages or the bare host', () => {
      expect(matchEmbedService('https://wakelet.com/@someuser')).toBeNull();
      expect(matchEmbedService('https://wakelet.com/')).toBeNull();
    });
  });

  describe('Poll Everywhere URL variants', () => {
    it('matches a presenter URL via the embeds host', () => {
      const result = matchEmbedService('https://pollev.com/teachername123');

      expect(result?.service).toBe('pollev');
      expect(result?.embedUrl).toBe('https://pollev-embeds.com/teachername123');
    });

    it('does not match reserved site paths', () => {
      expect(matchEmbedService('https://pollev.com/login')).toBeNull();
      expect(matchEmbedService('https://pollev.com/proctor')).toBeNull();
    });

    it('does not match multi-segment, uppercase or bare-host URLs', () => {
      expect(matchEmbedService('https://pollev.com/jsmith/extra')).toBeNull();
      expect(matchEmbedService('https://pollev.com/JSmith')).toBeNull();
      expect(matchEmbedService('https://pollev.com/')).toBeNull();
    });
  });

  describe('Wolfram Cloud URL variants', () => {
    it('matches a published object URL as a passthrough', () => {
      const result = matchEmbedService('https://www.wolframcloud.com/obj/demonstrations/CellularAutomaton-source.nb');

      expect(result?.service).toBe('wolframcloud');
      expect(result?.embedUrl).toBe('https://www.wolframcloud.com/obj/demonstrations/CellularAutomaton-source.nb');
    });

    it('normalizes onto the www host and keeps deep paths with query params', () => {
      expect(matchEmbedService('https://wolframcloud.com/obj/user-1a2b/Published/widget?x=1')?.embedUrl)
        .toBe('https://www.wolframcloud.com/obj/user-1a2b/Published/widget?x=1');
    });

    it('does not match the bare host or an empty object path', () => {
      expect(matchEmbedService('https://www.wolframcloud.com/')).toBeNull();
      expect(matchEmbedService('https://www.wolframcloud.com/obj/')).toBeNull();
    });
  });

  describe('Sketchfab URL variants', () => {
    it('matches a 3d-models slug URL and extracts the trailing hex id', () => {
      const result = matchEmbedService('https://sketchfab.com/3d-models/vintage-camera-cf2da81e2cd44e87b9e69eb9d6e6cab6');

      expect(result?.service).toBe('sketchfab');
      expect(result?.embedUrl).toBe('https://sketchfab.com/models/cf2da81e2cd44e87b9e69eb9d6e6cab6/embed');
    });

    it('matches a bare /models/ URL', () => {
      expect(matchEmbedService('https://www.sketchfab.com/models/cf2da81e2cd44e87b9e69eb9d6e6cab6')?.embedUrl)
        .toBe('https://sketchfab.com/models/cf2da81e2cd44e87b9e69eb9d6e6cab6/embed');
    });

    it('does not match category, tag or feed pages', () => {
      expect(matchEmbedService('https://sketchfab.com/3d-models/categories/animals-pets')).toBeNull();
      expect(matchEmbedService('https://sketchfab.com/tags/car')).toBeNull();
      expect(matchEmbedService('https://sketchfab.com/feed')).toBeNull();
    });
  });

  describe('OpenStreetMap URL variants', () => {
    it('converts a #map view into a 580x420 bbox export embed', () => {
      const result = matchEmbedService('https://www.openstreetmap.org/#map=13/51.5000/-0.1100');

      expect(result?.service).toBe('openstreetmap');
      expect(result?.embedUrl).toBe(
        'https://www.openstreetmap.org/export/embed.html?bbox=-0.159782,51.477559,-0.060218,51.522441&layer=mapnik'
      );
    });

    it('carries ?mlat/&mlon marker params into the embed', () => {
      const result = matchEmbedService('https://www.openstreetmap.org/?mlat=51.5074&mlon=-0.1278#map=15/51.5074/-0.1278');

      expect(result?.embedUrl).toBe(
        'https://www.openstreetmap.org/export/embed.html?bbox=-0.140245,51.501791,-0.115355,51.513009&layer=mapnik&marker=51.5074,-0.1278'
      );
    });

    it('clamps the bbox to world bounds at low zoom', () => {
      expect(matchEmbedService('https://www.openstreetmap.org/#map=1/84.0/179.0')?.embedUrl)
        .toBe('https://www.openstreetmap.org/export/embed.html?bbox=-24.906250,68.565719,180.000000,85.000000&layer=mapnik');
    });

    it('does not match object pages or the bare host', () => {
      expect(matchEmbedService('https://www.openstreetmap.org/')).toBeNull();
      expect(matchEmbedService('https://www.openstreetmap.org/relation/65606')).toBeNull();
      expect(matchEmbedService('https://www.openstreetmap.org/about')).toBeNull();
    });
  });

  describe('Tencent Video URL variants', () => {
    it('matches a cover watch URL and extracts the trailing vid', () => {
      const result = matchEmbedService('https://v.qq.com/x/cover/mzc00200xj9k3pa/j0032qtxztf.html');

      expect(result?.service).toBe('tencentvideo');
      expect(result?.embedUrl).toBe('https://v.qq.com/txp/iframe/player.html?vid=j0032qtxztf');
    });

    it('matches a single-video page URL', () => {
      expect(matchEmbedService('https://v.qq.com/x/page/j0032qtxztf.html?ptag=share')?.embedUrl)
        .toBe('https://v.qq.com/txp/iframe/player.html?vid=j0032qtxztf');
    });

    it('matches a mobile play URL with the vid in the query', () => {
      expect(matchEmbedService('https://m.v.qq.com/x/m/play?cid=mzc00200xj9k3pa&vid=j0032qtxztf')?.embedUrl)
        .toBe('https://v.qq.com/txp/iframe/player.html?vid=j0032qtxztf');
    });

    it('does not match channel pages or a mobile URL without a vid', () => {
      expect(matchEmbedService('https://v.qq.com/channel/movie')).toBeNull();
      expect(matchEmbedService('https://m.v.qq.com/x/m/play?cid=mzc00200xj9k3pa')).toBeNull();
    });
  });

  describe('Douyin URL variants', () => {
    it('matches a video URL via the open.douyin.com player', () => {
      const result = matchEmbedService('https://www.douyin.com/video/7331122334455667788');

      expect(result?.service).toBe('douyin');
      expect(result?.embedUrl).toBe('https://open.douyin.com/player/video?vid=7331122334455667788&autoplay=0');
    });

    it('does not match opaque short links or non-video pages', () => {
      expect(matchEmbedService('https://v.douyin.com/iYxA3Fn/')).toBeNull();
      expect(matchEmbedService('https://www.iesdouyin.com/share/video/7331122334455667788/')).toBeNull();
      expect(matchEmbedService('https://www.douyin.com/note/7331122334455667788')).toBeNull();
      expect(matchEmbedService('https://www.douyin.com/user/MS4wLjABAAAA')).toBeNull();
    });
  });

  describe('Kinescope URL variants', () => {
    it('matches a share URL via the /embed/ path', () => {
      const result = matchEmbedService('https://kinescope.io/0sjQ4cSGrqMVKj3KMTAn2g');

      expect(result?.service).toBe('kinescope');
      expect(result?.embedUrl).toBe('https://kinescope.io/embed/0sjQ4cSGrqMVKj3KMTAn2g');
    });

    it('matches an already-embed URL', () => {
      expect(matchEmbedService('https://kinescope.io/embed/0sjQ4cSGrqMVKj3KMTAn2g')?.embedUrl)
        .toBe('https://kinescope.io/embed/0sjQ4cSGrqMVKj3KMTAn2g');
    });

    it('does not match short-token site pages or the bare host', () => {
      expect(matchEmbedService('https://kinescope.io/pricing')).toBeNull();
      expect(matchEmbedService('https://kinescope.io/blog/how-to-embed')).toBeNull();
      expect(matchEmbedService('https://kinescope.io/')).toBeNull();
    });
  });

  describe('Vidio URL variants', () => {
    it('matches a watch URL and embeds the numeric id only', () => {
      const result = matchEmbedService('https://www.vidio.com/watch/7448242-keluarga-superior-eps-1?utm_source=share');

      expect(result?.service).toBe('vidio');
      expect(result?.embedUrl).toBe('https://www.vidio.com/embed/7448242');
    });

    it('does not match live channels or non-numeric paths', () => {
      expect(matchEmbedService('https://www.vidio.com/live/204-sctv')).toBeNull();
      expect(matchEmbedService('https://www.vidio.com/watch/abc-not-numeric')).toBeNull();
    });
  });

  describe('Mail.ru video URL variants', () => {
    it('matches a mail-user video page via the /video/embed/ form', () => {
      const result = matchEmbedService('https://my.mail.ru/mail/somename/video/_myvideo/123.html');

      expect(result?.service).toBe('mailru');
      expect(result?.embedUrl).toBe('https://my.mail.ru/mail/somename/video/embed/_myvideo/123');
    });

    it('matches community and catalog (v) pages', () => {
      expect(matchEmbedService('https://my.mail.ru/community/funpage/video/12/789.html?from=share')?.embedUrl)
        .toBe('https://my.mail.ru/community/funpage/video/embed/12/789');
      expect(matchEmbedService('https://my.mail.ru/v/topclips/video/embedded/456.html')?.embedUrl)
        .toBe('https://my.mail.ru/v/topclips/video/embed/embedded/456');
    });

    it('matches inbox, bk and list account domains', () => {
      expect(matchEmbedService('https://my.mail.ru/inbox/some.name/video/9/100.html')?.service).toBe('mailru');
      expect(matchEmbedService('https://my.mail.ru/bk/user-name/video/1/2.html')?.service).toBe('mailru');
      expect(matchEmbedService('https://my.mail.ru/list/listuser/video/3/4.html')?.service).toBe('mailru');
    });

    it('does not match album pages, photos or unknown account types', () => {
      expect(matchEmbedService('https://my.mail.ru/mail/somename/video/_myvideo')).toBeNull();
      expect(matchEmbedService('https://my.mail.ru/mail/somename/photo/1/2.html')).toBeNull();
      expect(matchEmbedService('https://my.mail.ru/other/somename/video/1/2.html')).toBeNull();
    });
  });

  describe('Smotrim URL variants', () => {
    it('matches a video page via the player iframe', () => {
      const result = matchEmbedService('https://smotrim.ru/video/2898424');

      expect(result?.service).toBe('smotrim');
      expect(result?.embedUrl).toBe('https://player.smotrim.ru/iframe/video/id/2898424/sid/smotrim');
    });

    it('does not match brand/article pages or the bare host', () => {
      expect(matchEmbedService('https://smotrim.ru/brand/60851')).toBeNull();
      expect(matchEmbedService('https://smotrim.ru/article/4509050')).toBeNull();
      expect(matchEmbedService('https://smotrim.ru/')).toBeNull();
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

    it('consumes the entire URL on the new provider patterns', () => {
      expect(fullMatch('ted', 'https://www.ted.com/talks/amy_cuddy_your_body_language_may_shape_who_you_are?language=es')).toBe(true);
      expect(fullMatch('internetarchive', 'https://archive.org/details/msdos_Prince_of_Persia_1990?some=param')).toBe(true);
      expect(fullMatch('kick', 'https://kick.com/asmongold?followed=true')).toBe(true);
      expect(fullMatch('peertube', 'https://tilvids.com/w/abc123XYZ?start=1m')).toBe(true);
      expect(fullMatch('odysee', 'https://odysee.com/@NafO:a/Odysee101:a?r=ABC')).toBe(true);
      expect(fullMatch('soop', 'https://vod.sooplive.com/player/123456789?change_second=10')).toBe(true);
      expect(fullMatch('coub', 'https://coub.com/view/2pc24rpb?from=share')).toBe(true);
      expect(fullMatch('bitchute', 'https://www.bitchute.com/video/UGlrf9d3vKHK/')).toBe(true);
      expect(fullMatch('reddit', 'https://www.reddit.com/r/programming/comments/1abc2de/some_title_slug/?utm_source=share')).toBe(true);
      expect(fullMatch('instagram', 'https://www.instagram.com/reel/C8zXq1NMabc/?igsh=xyz123')).toBe(true);
      expect(fullMatch('tidal', 'https://tidal.com/browse/track/46757219?u')).toBe(true);
      expect(fullMatch('calendly', 'https://calendly.com/acme-team/30min?month=2026-06')).toBe(true);
      expect(fullMatch('datawrapper', 'https://datawrapper.dwcdn.net/OhYbA/4/')).toBe(true);
      expect(fullMatch('openstreetmap', 'https://www.openstreetmap.org/#map=13/51.5000/-0.1100')).toBe(true);
      expect(fullMatch('tencentvideo', 'https://v.qq.com/x/page/j0032qtxztf.html?ptag=share')).toBe(true);
      expect(fullMatch('threads', 'https://www.threads.net/@zuck/post/C8z2Qq0Rk1x?xmt=AQGz')).toBe(true);
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

  describe('isSamePageLink', () => {
    it('treats bare anchors as same-page', () => {
      expect(isSamePageLink('#results')).toBe(true);
      expect(isSamePageLink('  #top')).toBe(true);
    });

    it('treats a URL resolving to the current origin + pathname as same-page', () => {
      const samePage = `${window.location.origin}${window.location.pathname}#section`;

      expect(isSamePageLink(samePage)).toBe(true);
      expect(isSamePageLink(window.location.href)).toBe(true);
    });

    it('treats cross-page and cross-origin URLs as not same-page', () => {
      expect(isSamePageLink('https://google.com')).toBe(false);
      expect(isSamePageLink(`${window.location.origin}/other-path`)).toBe(false);
    });

    it('treats a plain string that is not a URL as not same-page', () => {
      expect(isSamePageLink('just text')).toBe(false);
    });
  });

  describe('per-service minimum resize width', () => {
    const iframeServices = Object.entries(EMBED_SERVICES).filter(
      ([, config]) => config.kind !== 'script'
    );

    it('defines a positive minWidth on every iframe service', () => {
      const missing = iframeServices
        .filter(([, config]) => typeof config.minWidth !== 'number' || config.minWidth <= 0)
        .map(([key]) => key);

      expect(missing).toEqual([]);
    });

    it('never sets a minWidth above the service default width', () => {
      const violations = iframeServices
        .filter(([, config]) => config.width !== undefined && (config.minWidth ?? 0) > config.width)
        .map(([key]) => key);

      expect(violations).toEqual([]);
    });

    it('leaves script-rendered services without a resize minimum', () => {
      expect(EMBED_SERVICES.twitter.minWidth).toBeUndefined();
      expect(EMBED_SERVICES.telegram.minWidth).toBeUndefined();
      expect(EMBED_SERVICES.threads.minWidth).toBeUndefined();
    });
  });

  describe('height-resizable services', () => {
    it.each([
      'googledrive',
      'googledrivefolder',
      'googledocspublished',
      'googledocs',
      'googlesheets',
      'googleslides',
      'googleforms',
    ])('marks the Google document embed %s as height-resizable', (service) => {
      expect(EMBED_SERVICES[service].resizableHeight).toBe(true);
    });

    it('keeps aspect-driven media providers height-locked', () => {
      expect(EMBED_SERVICES.youtube.resizableHeight).toBeUndefined();
      expect(EMBED_SERVICES.vimeo.resizableHeight).toBeUndefined();
      expect(EMBED_SERVICES.spotify.resizableHeight).toBeUndefined();
    });
  });
});
