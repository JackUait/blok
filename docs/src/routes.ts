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
  route('*', './routes/not-found.tsx'),
] satisfies RouteConfig;
