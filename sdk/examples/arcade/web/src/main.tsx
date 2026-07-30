import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { captureSource } from './lib/referral.ts';
import 'performative-ui/styles.css';
import './index.css';

// Before the router rewrites the URL: a shared link's `utm_source` is only
// on the landing address, and nobody joins on the page they land on.
captureSource();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
