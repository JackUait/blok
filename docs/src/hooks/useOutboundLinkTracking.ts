import { useEffect } from "react";
import { trackOutboundLink } from "@/lib/analytics";

/**
 * Tracks clicks on links that leave the docs site.
 *
 * Delegated from the document rather than wired per-anchor: outbound links are
 * scattered across the footer, home page cards, tool docs and changelog, and
 * every hand-instrumented anchor is one that a future edit can silently drop.
 * One listener covers them all, including links added later.
 */
export const useOutboundLinkTracking = (): void => {
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      // The click often lands on a child (icon, span), so walk up to the anchor.
      const anchor = target.closest("a");
      const href = anchor?.getAttribute("href");
      if (!anchor || !href) {
        return;
      }

      // In-page anchors and non-http schemes (mailto:, tel:) are not outbound.
      if (href.startsWith("#")) {
        return;
      }

      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }

      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return;
      }

      if (url.origin === window.location.origin) {
        return;
      }

      const label =
        anchor.textContent?.trim() ||
        anchor.getAttribute("aria-label") ||
        url.hostname;

      trackOutboundLink(url.href, label);
    };

    // Capture phase: some links stop propagation, and a few close their popover
    // on click — either would swallow a bubble-phase listener.
    document.addEventListener("click", handleClick, { capture: true });
    return () =>
      document.removeEventListener("click", handleClick, { capture: true });
  }, []);
};
