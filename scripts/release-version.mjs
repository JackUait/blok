const releaseVersionPattern =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/**
 * Docker tags cannot contain SemVer build metadata, so family releases do not
 * accept it even though npm does.
 *
 * @param {string} version
 * @returns {boolean}
 */
export function isReleaseVersion(version) {
  return releaseVersionPattern.test(version);
}
