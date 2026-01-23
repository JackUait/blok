import { useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { DemoPage } from './pages/DemoPage';
import { ApiPage } from './pages/ApiPage';
import { MigrationPage } from './pages/MigrationPage';

function ScrollToTop() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    // Only scroll to top if there's no anchor in the URL
    if (!hash) {
      window.scrollTo(0, 0);
    }
  }, [pathname, hash]);

  return null;
}

function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/demo" element={<DemoPage />} />
        <Route path="/api" element={<ApiPage />} />
        <Route path="/migration" element={<MigrationPage />} />
      </Routes>
    </>
  );
}

export default App;
