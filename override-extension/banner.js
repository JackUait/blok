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
      'display:flex', 'gap:10px', 'align-items:center',
      'background:#12151b', 'color:#e8ebf0',
      'font:11.5px/1.5 ui-monospace,"SF Mono",Menlo,Consolas,monospace',
      'font-variant-numeric:tabular-nums',
      'padding:9px 12px', 'border-radius:10px',
      'border:1px solid ' + (tone === 'live' ? 'rgba(69,224,140,.5)' : 'rgba(240,180,76,.5)'),
      'box-shadow:0 4px 18px rgba(0,0,0,.45)',
    ].join(';');
    const dot = document.createElement('span');
    dot.style.cssText = [
      'width:7px', 'height:7px', 'border-radius:50%', 'flex:none',
      'background:' + (tone === 'live' ? '#45e08c' : '#f0b44c'),
      'box-shadow:0 0 7px ' + (tone === 'live' ? 'rgba(69,224,140,.5)' : 'rgba(240,180,76,.5)'),
    ].join(';');
    const label = document.createElement('span');
    label.textContent = text;
    const close = document.createElement('button');
    close.textContent = '×';
    close.setAttribute('aria-label', 'Dismiss blok override banner');
    close.style.cssText = 'background:none;border:0;color:#8a93a3;font-size:14px;cursor:pointer;padding:0;line-height:1;';
    close.addEventListener('mouseenter', () => { close.style.color = '#e8ebf0'; });
    close.addEventListener('mouseleave', () => { close.style.color = '#8a93a3'; });
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
      showBanner(`blok override active — ${running}`, 'live');
    } else {
      showBanner(`blok override armed — page runs ${running ?? 'pre-seam blok'}, local is ${status.current.version}. Rebuild? Reload?`, 'skew');
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
