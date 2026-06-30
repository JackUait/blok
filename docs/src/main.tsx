import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { I18nProvider } from './contexts/I18nContext';
import { FrameworkProvider } from './contexts/FrameworkContext';
import App from './App';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Failed to find root element');
}
createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <FrameworkProvider>
          <App />
        </FrameworkProvider>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>,
);
