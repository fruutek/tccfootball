// @ts-check
import react from '@astrojs/react';
import { defineConfig } from 'astro/config';

/**
 * Match, player and article pages are one static "shell" each that reads its id
 * from the URL and loads data from Firestore in the browser — that is what lets
 * a published result appear without redeploying the site.
 *
 * Firebase Hosting rewrites /matches/**, /players/** and /news/** to those
 * shells (see firebase.json). This tiny integration does the same in `astro dev`.
 */
const dynamicRouteShells = () => ({
  name: 'mnf-dynamic-route-shells',
  hooks: {
    /** @param {{ server: import('vite').ViteDevServer }} ctx */
    'astro:server:setup': ({ server }) => {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? '';
        const m = /^\/(matches|players|news)\/([^/?#.]+)(.*)$/.exec(url);
        if (m && m[2] !== '_') req.url = `/${m[1]}/_${m[3] ?? ''}`;
        next();
      });
    },
  },
});

export default defineConfig({
  output: 'static',
  // "/matches" not "/matches/", matching Firebase Hosting's cleanUrls + trailingSlash:false.
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [react(), dynamicRouteShells()],
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  devToolbar: { enabled: false },
  server: { port: 4321, host: true },
});
