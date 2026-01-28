import { useEffect, useRef } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { HomePage } from "./pages/HomePage";
import { DemoPage } from "./pages/DemoPage";
import { ApiPage } from "./pages/ApiPage";
import { MigrationPage } from "./pages/MigrationPage";
import { RecipesPage } from "./pages/RecipesPage";
import ChangelogPage from "./pages/ChangelogPage";
import { PageTransition } from "./components/common/PageTransition";

const ScrollHandler = () => {
  const { pathname, hash } = useLocation();
  const initialPath = useRef(pathname);

  useEffect(() => {
    // Handle hash scrolling
    const shouldScrollToTop = !hash && pathname !== initialPath.current;
    if (shouldScrollToTop) {
      window.scrollTo(0, 0);
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

const App = () => {
  const location = useLocation();

  // Disable browser's automatic scroll restoration on page reload
  // This prevents the browser from scrolling back to the previous position
  useEffect(() => {
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual';
    }
  }, []);

  return (
    <>
      <ScrollHandler />
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={<PageTransition><HomePage /></PageTransition>} />
          <Route path="/demo" element={<PageTransition><DemoPage /></PageTransition>} />
          <Route path="/recipes" element={<PageTransition><RecipesPage /></PageTransition>} />
          <Route path="/docs" element={<PageTransition><ApiPage /></PageTransition>} />
          <Route path="/migration" element={<PageTransition><MigrationPage /></PageTransition>} />
          <Route path="/changelog" element={<PageTransition><ChangelogPage /></PageTransition>} />
        </Routes>
      </AnimatePresence>
    </>
  );
};

export default App;
