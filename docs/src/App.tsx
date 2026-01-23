import { useEffect, useRef } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { DemoPage } from './pages/DemoPage';
import { ApiPage } from './pages/ApiPage';
import { MigrationPage } from './pages/MigrationPage';

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
        behavior: 'smooth',
        block: 'start',
      });
    }
  }, [pathname, hash]);

  return null;
};

const App = () => {
  return (
    <>
      <ScrollHandler />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/demo" element={<DemoPage />} />
        <Route path="/docs" element={<ApiPage />} />
        <Route path="/migration" element={<MigrationPage />} />
      </Routes>
    </>
  );
}

export default App;
