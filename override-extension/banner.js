(() => {
  const showBanner = (text) => {
    if (document.getElementById('blok-override-banner')) {
      return;
    }
    const banner = document.createElement('div');
    banner.id = 'blok-override-banner';
    banner.setAttribute('role', 'status');
    banner.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:2147483647;background:#111;color:#fff;font:12px/1.4 system-ui,sans-serif;padding:8px 12px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.35);display:flex;gap:10px;align-items:center;';
    const label = document.createElement('span');
    label.textContent = text;
    const close = document.createElement('button');
    close.textContent = '×';
    close.setAttribute('aria-label', 'Dismiss blok override banner');
    close.style.cssText = 'background:none;border:0;color:#fff;font-size:14px;cursor:pointer;padding:0;';
    close.addEventListener('click', () => banner.remove());
    banner.append(label, close);
    document.body.appendChild(banner);
  };

  const report = async () => {
    const status = await chrome.runtime.sendMessage({ type: 'status' });
    if (!status?.current) {
      return;
    }
    const editor = document.querySelector('[data-blok-version]');
    const running = editor?.getAttribute('data-blok-version') ?? null;
    if (running === status.current.version) {
      showBanner(`blok override active — ${running}`);
    } else {
      showBanner(`blok override armed — page runs ${running ?? 'pre-seam blok'}, local is ${status.current.version}. Rebuild? Reload?`);
    }
  };

  // The editor may mount after document_idle — retry briefly before reporting
  // "pre-seam", then report whatever is there.
  let attempts = 0;
  const tick = () => {
    attempts += 1;
    if (document.querySelector('[data-blok-version]') || attempts >= 10) {
      void report();
    } else {
      setTimeout(tick, 500);
    }
  };
  tick();
})();
