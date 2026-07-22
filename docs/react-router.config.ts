import type { Config } from '@react-router/dev/config';
import { PRERENDER_PATHS } from './src/prerender-paths';

export default {
  appDirectory: 'src',
  // No server runtime: GitHub Pages only serves files. `prerender` turns every
  // known URL into a real HTML file so deep links answer 200 with prose in the
  // body instead of the redirect stub's empty 404.
  ssr: false,
  buildDirectory: 'dist',
  prerender: () => PRERENDER_PATHS,
} satisfies Config;
