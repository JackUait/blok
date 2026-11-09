// Release helpers for the Rust crates that `cargo install blok-mcp` needs.

/**
 * Moves the Rust workspace to the release version: `[workspace.package]`
 * `version` and each `=X` pin in `[workspace.dependencies]`.
 * @param {string} source - packages/server/rust/Cargo.toml
 * @param {string} version
 * @returns {string}
 */
export function bumpCargoWorkspaceVersion(source, version) {
  const packageVersion = /(\[workspace\.package\]\n(?:[^[\n][^\n]*\n|\n)*?)version = "[^"]+"/;

  if (!packageVersion.test(source)) {
    throw new Error('Cargo.toml has no [workspace.package] version');
  }

  return source
    .replace(packageVersion, `$1version = "${version}"`)
    .replace(/^(blok-[\w-]+ = \{ path = "[^"]+", version = )"=[^"]+"/gm, `$1"=${version}"`);
}

/**
 * The crates the workspace publishes: the ones pinned in `[workspace.dependencies]`.
 * @param {string} source - packages/server/rust/Cargo.toml
 * @returns {string[]}
 */
export function publishedCrates(source) {
  return [...source.matchAll(/^(blok-[\w-]+) = \{ path = "[^"]+", version = "=[^"]+" \}$/gm)].map((match) => match[1]);
}

/**
 * Orders crates so each comes after the crates it depends on.
 * @param {Record<string, string[]>} deps - crate name to its blok dependencies
 * @returns {string[]}
 */
export function publishOrder(deps) {
  const order = [];
  const state = new Map();
  const visit = (name, trail) => {
    if (state.get(name) === 'done') {
      return;
    }

    if (state.get(name) === 'open') {
      throw new Error(`dependency cycle: ${[...trail, name].join(' -> ')}`);
    }
    state.set(name, 'open');

    for (const dep of deps[name] ?? []) {
      visit(dep, [...trail, name]);
    }
    state.set(name, 'done');
    order.push(name);
  };

  for (const name of Object.keys(deps).sort()) {
    visit(name, []);
  }

  return order;
}

/**
 * crates.io lets an account publish 5 new crates at once, then 1 every 10 minutes.
 * @param {string} output - cargo publish stderr
 * @returns {boolean}
 */
export function isNewCrateRateLimit(output) {
  return output.includes('published too many new crates');
}
