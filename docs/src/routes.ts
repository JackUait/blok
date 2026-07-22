import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
  index('./routes/home.tsx'),
  route('demo', './routes/demo.tsx'),
  // Splat, not ":moduleId": ApiPage renders its own nested <Routes> so the
  // sidebar/TOC chrome stays mounted across module navigation.
  route('docs/*', './routes/api.tsx'),
  route('tools', './routes/tools.tsx'),
  route('migration', './routes/migration.tsx'),
  route('migration/reference', './routes/migration-reference.tsx'),
  route('changelog', './routes/changelog.tsx'),

  // The Russian tree. Locale belongs in the address, not in localStorage: while
  // it lived in storage the finished translation had no URL, so it could never
  // be crawled, linked, or annotated with hreflang. Same route modules and same
  // components — the copy follows the locale the path resolves to. The explicit
  // ids are required because React Router derives a route id from its file, and
  // each module now backs two routes. Nested <Routes> inside these modules
  // resolve relative to the match, so `/ru/docs/table` still yields "table".
  route('ru', './routes/home.tsx', { id: 'ru-home' }),
  route('ru/demo', './routes/demo.tsx', { id: 'ru-demo' }),
  route('ru/docs/*', './routes/api.tsx', { id: 'ru-api' }),
  route('ru/tools', './routes/tools.tsx', { id: 'ru-tools' }),
  route('ru/migration', './routes/migration.tsx', { id: 'ru-migration' }),
  route('ru/migration/reference', './routes/migration-reference.tsx', {
    id: 'ru-migration-reference',
  }),
  route('ru/changelog', './routes/changelog.tsx', { id: 'ru-changelog' }),

  route('*', './routes/not-found.tsx'),
] satisfies RouteConfig;
