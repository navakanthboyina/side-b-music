import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';

const injectCharacterLab = (): Plugin => ({
  name: 'munnas-grooves-character-lab-overlay',
  transformIndexHtml(html) {
    return html.replace(
      '</head>',
      '  <link rel="stylesheet" href="/character-lab/src/dev.css">\n  <script type="module" src="/character-lab/src/dev-entry.ts"></script>\n</head>'
    );
  }
});

export default defineConfig({
  root: resolve(__dirname, '..'),
  publicDir: resolve(__dirname, 'public'),
  plugins: [injectCharacterLab()],
  server: {
    fs: { allow: [resolve(__dirname, '..')] }
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true
  }
});
