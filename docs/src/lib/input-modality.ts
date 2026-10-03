/**
 * Records on <html> whether the user last drove the page with the keyboard or
 * a pointer. index.css gates every focus ring on it: `:focus-visible` alone
 * still matches after a click on a text field, or when script moves focus
 * right after a click.
 *
 * Inline in <head> so the very first gesture is recorded. Capture phase so a
 * handler that stops propagation cannot hide a gesture.
 */
export const INPUT_MODALITY_SCRIPT = `
(function() {
  var root = document.documentElement;
  var set = function(modality) { root.setAttribute('data-modality', modality); };

  set('keyboard');
  document.addEventListener('keydown', function() { set('keyboard'); }, true);
  document.addEventListener('pointerdown', function() { set('pointer'); }, true);
})();`;
