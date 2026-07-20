/**
 * Describes the runtime theme-tokens API.
 *
 * Blok injects a stylesheet for `--blok-*` overrides that targets the editor
 * wrapper *and* the body-mounted portal scopes (popovers, tooltips, top-layer
 * elements). Those portals cannot inherit custom properties from the holder,
 * so that sheet is the only styling channel that reaches them — which is why
 * a host with a live light/dark toggle needs to rewrite it at runtime rather
 * than reconstructing the editor.
 */
export interface Tokens {
  /**
   * Returns the tokens currently applied, after validation — entries rejected
   * as invalid are absent. Before any `set()` call this reflects
   * `config.style.tokens`.
   */
  get(): Record<string, string>;

  /**
   * Replaces the applied token set.
   *
   * Replace (not merge) semantics: the argument is the complete set, mirroring
   * `config.style.tokens`, so tokens omitted from it stop applying — pass the
   * whole palette on a theme flip. Passing `{}` removes the stylesheet.
   *
   * Keys must match `--blok-*`; invalid entries are skipped with a warning.
   * State-dependent `--blok-editor-gutter-*` keys are rejected (they collapse
   * automatically in read-only mode and must be set via CSS instead).
   * @param tokens - complete set of `--blok-*` overrides to apply
   */
  set(tokens: Record<string, string>): void;
}
