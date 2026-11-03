/**
 * Sandbox for REGISTRY provider iframes, shared by the embed tool and the
 * headless view so both frame a provider the same way. Only a URL derived from
 * a registry match may get it; generic embeds use GENERIC_IFRAME_SANDBOX.
 *
 * `allow-same-origin` is deliberately kept alongside `allow-scripts`: it is
 * only dangerous when the framed document shares the host page's origin (or
 * runs a `javascript:`/`data:` URL, which inherits it). A registry URL is an
 * absolute https URL on the provider's own origin, so the frame stays
 * cross-origin to the host. Providers (YouTube, Vimeo, Spotify, …) need
 * same-origin access to their OWN origin for storage/player APIs; removing it
 * breaks most players. Any change here must keep that guarantee intact (see
 * the link-url-sink-law architecture test).
 *
 * `allow-popups-to-escape-sandbox` is equally load-bearing: without it a popup
 * opened from the frame INHERITS this sandbox flag set, and providers refuse to
 * serve their own pages into a sandboxed top-level document — YouTube answers
 * the inherited-sandbox tab with ERR_BLOCKED_BY_RESPONSE, so the player's
 * "Watch on YouTube" button lands readers on a browser error page instead of
 * the video.
 */
export const IFRAME_SANDBOX =
  'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation';

/**
 * Sandbox for a generic (non-registry) embed: any https page the host let in.
 * Never add allow-same-origin (gives the page its cookies and storage, and on
 * the host's origin lifts the sandbox), allow-top-navigation*, allow-downloads,
 * allow-modals or allow-popups-to-escape-sandbox. Popups stay sandboxed.
 */
export const GENERIC_IFRAME_SANDBOX = 'allow-scripts allow-forms allow-popups';
