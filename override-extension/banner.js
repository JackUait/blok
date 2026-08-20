(() => {
  const showBanner = (text, tone) => {
    if (document.getElementById('blok-override-banner')) {
      return;
    }
    const banner = document.createElement('div');
    banner.id = 'blok-override-banner';
    banner.setAttribute('role', 'status');
    banner.style.cssText = [
      'position:fixed', 'bottom:14px', 'right:14px', 'z-index:2147483647',
      'display:flex', 'gap:8px', 'align-items:center',
      'background:#ffffff', 'color:#37352f',
      'font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif',
      'padding:8px 12px', 'border-radius:6px',
      'border:1px solid rgba(55,53,47,0.16)',
      'box-shadow:rgba(15,15,15,0.05) 0 0 0 1px, rgba(15,15,15,0.1) 0 3px 6px, rgba(15,15,15,0.2) 0 9px 24px',
    ].join(';');
    const dot = document.createElement('span');
    dot.style.cssText = [
      'width:8px', 'height:8px', 'border-radius:50%', 'flex:none',
      'background:' + (tone === 'live' ? '#448361' : '#d9730d'),
    ].join(';');
    const label = document.createElement('span');
    label.textContent = text;
    const close = document.createElement('button');
    close.textContent = '×';
    close.setAttribute('aria-label', 'Dismiss blok override banner');
    close.style.cssText = 'background:none;border:0;color:#9b9a97;font-size:14px;cursor:pointer;padding:0;line-height:1;';
    close.addEventListener('mouseenter', () => { close.style.color = '#37352f'; });
    close.addEventListener('mouseleave', () => { close.style.color = '#9b9a97'; });
    close.addEventListener('click', () => banner.remove());
    banner.append(dot, label, close);
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
      showBanner(`Blok override is on — running ${running}`, 'live');
    } else {
      showBanner(`Blok override is waiting — this page runs ${running ?? 'an older Blok'}, your local build is ${status.current.version}. Try reloading.`, 'skew');
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
