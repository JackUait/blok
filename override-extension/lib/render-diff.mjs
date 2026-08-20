// The popup re-renders on a 600ms poll while a swap is in flight. Replacing
// identical DOM every tick replays entrance animations and collapses whatever
// the user had open — so a render only commits when its serialized output
// actually changed, and the few bits of user-held state survive the replace.

// Skipping the replace keeps the OLD event listeners alive. That is safe only
// while every value a handler closes over (origin, redirect prefix, …) is
// visible in the serialized HTML — equal markup then implies equivalent
// closures. A handler capturing state the markup doesn't reflect breaks this
// silently; reflect it (data-* attribute) instead.
export const panelsEqual = (current, next) => normalized(current) === normalized(next);

const normalized = (root) => {
  const clone = root.cloneNode(true);
  for (const details of clone.querySelectorAll('details[open]')) {
    details.removeAttribute('open');
  }
  // Combobox ephemera (expansion, search filtering, keyboard-active option)
  // are user-held state, not render output — normalize to the closed default
  // so a background poll doesn't replace the DOM out from under an open list.
  for (const combo of clone.querySelectorAll('[data-combobox]')) {
    for (const el of combo.querySelectorAll('[aria-expanded]')) {
      el.setAttribute('aria-expanded', 'false');
    }
    for (const el of combo.querySelectorAll('[aria-activedescendant]')) {
      el.removeAttribute('aria-activedescendant');
    }
    for (const panel of combo.querySelectorAll('[data-combobox-panel]')) {
      panel.setAttribute('hidden', '');
      for (const el of panel.querySelectorAll('[hidden]')) {
        el.removeAttribute('hidden');
      }
      for (const el of panel.querySelectorAll('[data-active]')) {
        el.removeAttribute('data-active');
      }
    }
  }
  return clone.innerHTML;
};

export const captureEphemeral = (root) => {
  const active = root.getRootNode().activeElement;
  return {
    open: [...root.querySelectorAll('details[open][data-key]')].map((d) => d.dataset.key),
    selects: Object.fromEntries([...root.querySelectorAll('select[id]')].map((s) => [s.id, s.value])),
    combos: Object.fromEntries([...root.querySelectorAll('[data-combobox][data-key]')].map((combo) => [
      combo.dataset.key,
      {
        open: !(combo.querySelector('[data-combobox-panel]')?.hidden ?? true),
        query: combo.querySelector('input')?.value ?? '',
      },
    ])),
    focus: active && root.contains(active) ? active.getAttribute('aria-label') ?? active.id ?? null : null,
  };
};

export const restoreEphemeral = (root, snapshot) => {
  for (const key of snapshot.open) {
    const details = root.querySelector(`details[data-key="${key}"]`);
    if (details) {
      details.open = true;
    }
  }
  for (const [id, value] of Object.entries(snapshot.selects)) {
    const select = root.querySelector(`select[id="${id}"]`);
    if (select && [...select.options].some((o) => o.value === value)) {
      select.value = value;
    }
  }
  // The fresh DOM carries fresh listeners — replay the user's state through
  // them (an input event re-filters, a trigger click re-opens) instead of
  // reaching into widget internals render-diff knows nothing about.
  for (const [key, combo] of Object.entries(snapshot.combos ?? {})) {
    const host = root.querySelector(`[data-combobox][data-key="${key}"]`);
    if (!host) {
      continue;
    }
    const input = host.querySelector('input');
    if (input && combo.query !== '') {
      input.value = combo.query;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (combo.open) {
      host.querySelector('button')?.click();
    }
  }
  if (snapshot.focus) {
    const target = root.querySelector(`[aria-label="${CSS.escape(snapshot.focus)}"]`)
      ?? root.querySelector(`#${CSS.escape(snapshot.focus)}`);
    target?.focus();
  }
};
