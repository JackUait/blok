import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { PageTransition } from "./components/common/PageTransition";
import { usePageTracking } from "./hooks/usePageTracking";
import { useOutboundLinkTracking } from "./hooks/useOutboundLinkTracking";

const SCROLL_STORAGE_PREFIX = "blok-docs:scroll:";

const ScrollHandler = () => {
  const { pathname, hash } = useLocation();
  const isInitialLoad = useRef(true);
  const previousPathname = useRef(pathname);
  // True while we're re-applying a restored scroll position. Our own scrollTo
  // calls get clamped on a not-yet-tall page and fire scroll events; without
  // this guard the save listener would overwrite the target with the clamped
  // (smaller) value and corrupt it for the next reload.
  const isRestoring = useRef(false);

  // Persist the scroll position for the current path so a reload can restore it.
  useEffect(() => {
    const key = SCROLL_STORAGE_PREFIX + pathname;
    const save = () => {
      if (isRestoring.current) {
        return;
      }
      sessionStorage.setItem(key, String(window.scrollY));
    };

    window.addEventListener("scroll", save, { passive: true });
    // pagehide fires on reload/close even when a final scroll event doesn't.
    window.addEventListener("pagehide", save);

    return () => {
      window.removeEventListener("scroll", save);
      window.removeEventListener("pagehide", save);
    };
  }, [pathname]);

  // On the first render after a (re)load, restore where the user left off.
  // Native scrollRestoration is unreliable here because content renders
  // progressively (page transition, lazy sections), so the document isn't tall
  // enough to reach the saved offset at restore time and the browser clamps it.
  useLayoutEffect(() => {
    const saved = sessionStorage.getItem(SCROLL_STORAGE_PREFIX + pathname);
    const targetY = saved === null ? 0 : Number(saved);

    if (!Number.isFinite(targetY) || targetY <= 0) {
      return;
    }

    isRestoring.current = true;
    let frameId = 0;
    let timeoutId = 0;

    const stop = () => {
      isRestoring.current = false;
      cancelAnimationFrame(frameId);
      clearTimeout(timeoutId);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", stop);
    };

    // Re-apply the scroll until the page has grown tall enough to actually reach
    // targetY, then hand control back. "instant" avoids animating against the
    // root's CSS scroll-behavior: smooth.
    const restore = () => {
      window.scrollTo({ top: targetY, left: 0, behavior: "instant" });
      const maxReachable =
        document.documentElement.scrollHeight - window.innerHeight;
      if (maxReachable >= targetY) {
        stop();
      } else {
        frameId = requestAnimationFrame(restore);
      }
    };

    // Bail out the moment the user takes over, and give up after a generous
    // settle window if the page never grows tall enough.
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchstart", stop, { passive: true });
    window.addEventListener("keydown", stop);
    timeoutId = window.setTimeout(stop, 3000);

    restore();

    return stop;
    // Restore only once, for the path present at load time. In-app navigation
    // is handled by the route-change effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // On initial page load (including reload), restoration is handled above.
    if (isInitialLoad.current) {
      isInitialLoad.current = false;
      previousPathname.current = pathname;
      return;
    }

    // Handle navigation between routes
    const isNewRoute = pathname !== previousPathname.current;
    previousPathname.current = pathname;

    if (isNewRoute && !hash) {
      // Explicit "instant" bypasses the root's CSS scroll-behavior: smooth so
      // navigating to a new page jumps to the top instead of animating there.
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      return;
    }

    if (!hash) {
      return;
    }

    // Remove the # character
    const id = hash.slice(1);
    const element = document.getElementById(id);

    if (element) {
      element.scrollIntoView({
        behavior: "auto",
        block: "start",
      });
    }
  }, [pathname, hash]);

  return null;
};

/**
 * Chrome shared by every route: analytics, scroll handling and the page
 * transition. The route element itself arrives as `children` — root.tsx passes
 * the router's <Outlet />, so the route table lives in src/routes.ts.
 */
const App = ({ children }: { children: ReactNode }) => {
  const location = useLocation();

  // Analytics: gtag is loaded in root.tsx with automatic page views off, so
  // these two hooks are the site's only sources of page views and outbound
  // link clicks.
  usePageTracking();
  useOutboundLinkTracking();

  // Take manual control of scroll restoration; we restore it ourselves in
  // ScrollHandler because native restoration is unreliable with progressively
  // rendered content.
  useEffect(() => {
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual';
    }
  }, []);

  const routeKey = location.pathname.split('/')[1] || 'home';

  return (
    <>
      <ScrollHandler />
      <AnimatePresence mode="wait">
        <PageTransition key={routeKey}>{children}</PageTransition>
      </AnimatePresence>
    </>
  );
};

export default App;
