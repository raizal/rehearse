import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles.css';
import './styles/story.css';
import './styles/codemap.css';
import './styles/diagrams.css';
import './styles/docs.css';
import './styles/featuremap.css';
import './styles/coverage.css';
import './styles/present.css';
import { App } from './App.js';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
