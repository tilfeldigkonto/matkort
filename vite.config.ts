import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const require = createRequire(import.meta.url);

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "connect-src 'self'",
  "font-src 'self'",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'"
].join('; ');

interface OcrAsset { urlPath: string; file: string; type: string }

/** Worker, WASM og norsk språkmodell fra installerte pakker. Ingen CDN. */
function ocrAssets(): OcrAsset[] {
  const coreDir = path.dirname(require.resolve('tesseract.js-core/package.json'));
  const langDir = path.dirname(require.resolve('@tesseract.js-data/nor/package.json'));
  const names = [
    'tesseract-core-lstm.wasm.js',
    'tesseract-core-lstm.wasm',
    'tesseract-core-simd-lstm.wasm.js',
    'tesseract-core-simd-lstm.wasm'
  ];
  const files: OcrAsset[] = [
    { urlPath: '/ocr/worker.min.js', file: require.resolve('tesseract.js/dist/worker.min.js'), type: 'text/javascript' },
    ...names.map(name => ({
      urlPath: `/ocr/core/${name}`,
      file: path.join(coreDir, name),
      type: name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'
    })),
    {
      urlPath: '/ocr/lang/nor.traineddata.gz',
      file: path.join(langDir, '4.0.0_best_int', 'nor.traineddata.gz'),
      type: 'application/octet-stream'
    }
  ];
  for (const item of files) {
    if (!existsSync(item.file)) throw new Error(`Mangler OCR-fil: ${item.file}`);
  }
  return files;
}

function serveOcr(base: string): Connect.NextHandleFunction {
  const files = new Map(ocrAssets().map(item => [item.urlPath, item]));
  return (req, res, next) => {
    const pathname = (req.url ?? '').split('?')[0];
    if (!pathname.startsWith(base)) return next();
    const match = files.get(`/${pathname.slice(base.length)}`);
    if (!match) return next();
    res.setHeader('Content-Type', match.type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache');
    createReadStream(match.file).pipe(res);
  };
}

function localOcrAssets(): Plugin {
  return {
    name: 'local-ocr-assets',
    configureServer(server) {
      server.middlewares.use(serveOcr(server.config.base));
    },
    generateBundle() {
      for (const item of ocrAssets()) {
        this.emitFile({ type: 'asset', fileName: item.urlPath.slice(1), source: readFileSync(item.file) });
      }
    }
  };
}

function productionCsp(): Plugin {
  return {
    name: 'production-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">`);
    }
  };
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  define: {
    __MATKORT_BASE__: JSON.stringify(process.env.VITE_BASE_PATH || '/')
  },
  server: { host: 'localhost', fs: { strict: true } },
  preview: { host: 'localhost' },
  plugins: [
    react(),
    localOcrAssets(),
    productionCsp(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png', 'favicon.svg'],
      manifest: {
        name: 'Matkort – næringskalkulator',
        short_name: 'Matkort',
        description: 'Regn ut næringsinnhold for produkter og hjemmelagde retter.',
        id: '.',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        theme_color: '#f8f9f5',
        background_color: '#f8f9f5',
        lang: 'nb',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'],
        globIgnores: ['**/ocr/**'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            // Første skanning henter worker, WASM og språkmodell fra samme opprinnelse.
            urlPattern: ({ url }) => url.origin === self.location.origin && url.pathname.includes('/ocr/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'matkort-ocr',
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          }
        ]
      }
    })
  ]
});
