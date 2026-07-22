import { Link } from 'react-router-dom';
import { Nav } from '../components/layout/Nav';
import { Footer } from '../components/layout/Footer';
import { NAV_LINKS } from '../utils/constants';

/**
 * Real not-found page. It is prerendered to `/404/index.html` and copied to
 * `404.html` by the build script, which is the file GitHub Pages serves for any
 * path with no matching file — replacing the redirect stub that used to answer
 * every deep link with an empty 404 body.
 */
export const meta = () => [
  { title: 'Page not found — Blok' },
  { name: 'robots', content: 'noindex' },
];

const NotFoundPage = () => (
  <>
    <Nav links={NAV_LINKS} />
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto flex max-w-3xl flex-col items-center px-6 pt-32 pb-24 text-center"
    >
      <p className="font-mono text-sm font-bold tracking-widest text-muted-foreground uppercase">
        404
      </p>
      <h1 className="mt-4 font-display text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl">
        Page not found
      </h1>
      <p className="mt-4 text-lg text-muted-foreground">
        That URL does not exist. It may have moved, or the link that brought you here may be out of
        date.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link
          to="/"
          className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          Back to home
        </Link>
        <Link
          to="/docs/quick-start"
          className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-foreground"
        >
          Read the docs
        </Link>
      </div>
    </main>
    <Footer />
  </>
);

export default NotFoundPage;
