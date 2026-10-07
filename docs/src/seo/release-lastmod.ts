// Node-side only (sitemap, markdown mirrors, tests). Importing this from page
// code puts all of CHANGELOG.md into that route's bundle.
import CHANGELOG from '../../../CHANGELOG.md?raw';
import { lastModified, latestReleaseDate } from './lastmod';

const RELEASE_DATE = latestReleaseDate(CHANGELOG);

/** lastModified, with the changelog trees dated by their newest release too. */
export const lastModifiedWithRelease = (route: string): string | undefined => lastModified(route, RELEASE_DATE);
