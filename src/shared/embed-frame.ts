import type { EmbedService } from './embed-registry';

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
 * Popups opened from this frame keep the sandbox. In Firefox a popup that
 * escaped it can set `opener.top.location` and move the host tab, even under
 * COOP same-origin-allow-popups, so a provider that serves code or pages its
 * users wrote (CodePen, JSFiddle, a PeerTube instance, …) must never escape.
 */
export const IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-presentation';

/**
 * {@link IFRAME_SANDBOX} plus `allow-popups-to-escape-sandbox`, for media
 * players that opt in with `popupsEscapeSandbox`. A popup that inherits the
 * sandbox is refused by some providers: YouTube answers ERR_BLOCKED_BY_RESPONSE,
 * so "Watch on YouTube" would open a browser error page.
 */
export const PLAYER_IFRAME_SANDBOX =
  'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation';

/** The sandbox for a registry entry. Opt-in only, so a new entry stays boxed. */
export function registryIframeSandbox(service: Pick<EmbedService, 'popupsEscapeSandbox'> | undefined): string {
  return service?.popupsEscapeSandbox === true ? PLAYER_IFRAME_SANDBOX : IFRAME_SANDBOX;
}

/**
 * Sandbox for a generic (non-registry) embed: any https page the host let in.
 * Never add allow-same-origin (gives the page its cookies and storage, and on
 * the host's origin lifts the sandbox), allow-top-navigation*, allow-downloads,
 * allow-modals or allow-popups-to-escape-sandbox. Popups stay sandboxed.
 */
export const GENERIC_IFRAME_SANDBOX = 'allow-scripts allow-forms allow-popups';
