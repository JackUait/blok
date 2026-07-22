import { forwardRef } from 'react';
import { Link as RouterLink, type LinkProps as RouterLinkProps } from 'react-router-dom';
import { useLocalizedHref } from '../../contexts/I18nContext';

export interface LinkProps extends Omit<RouterLinkProps, 'to'> {
  /** A site-absolute path written as its English address, e.g. `/docs/table`. */
  to: string;
}

/**
 * The app's internal link: react-router's `<Link>` with the address mapped into
 * the locale tree the reader is currently in.
 *
 * Import this instead of react-router's `Link` anywhere under `components/`,
 * `pages/` or `routes/`. The only exceptions are the two language switches
 * (`Footer`, `LanguageSelector`), whose job is to cross trees — they build a
 * fully-qualified address themselves and must not be re-prefixed.
 */
export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link({ to, ...props }, ref) {
  const localizedHref = useLocalizedHref();

  return <RouterLink ref={ref} to={localizedHref(to)} {...props} />;
});
