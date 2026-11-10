(() => {
  if (document.querySelector('[data-evans-picker]')) return;
  const overlay = document.createElement('div'); overlay.dataset.evansPicker = '';
  Object.assign(overlay.style, {position: 'fixed', zIndex: '2147483647', pointerEvents: 'none', border: '2px solid #8f4178', background: '#8f417818'});
  const banner = document.createElement('div'); banner.dataset.evansPicker = '';
  Object.assign(banner.style, {position: 'fixed', top: '16px', left: '50%', transform: 'translateX(-50%)', zIndex: '2147483647', background: '#251e28', color: 'white', padding: '14px 24px', borderRadius: '8px', font: '14px system-ui', boxShadow: '0 2px 8px #0003'});
  banner.textContent = 'Evans · Click the region to monitor. Esc to cancel.';
  document.documentElement.append(overlay, banner);
  function selector(el) {
    if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) return `#${CSS.escape(el.id)}`;
    const path = [];
    while (el && el !== document.body) {
      if (el.id) { path.unshift(`#${CSS.escape(el.id)}`); break; }
      const name = el.tagName.toLowerCase();
      const siblings = [...(el.parentElement?.children || [])].filter(e => e.tagName === el.tagName);
      path.unshift(name + (siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(el) + 1})` : ''));
      const candidate = path.join(' > ');
      if (document.querySelectorAll(candidate).length === 1) return candidate;
      el = el.parentElement;
    }
    return path.length ? path.join(' > ') : 'body';
  }
  const move = e => {
    if (e.target.closest('[data-evans-picker]')) return;
    const r = e.target.getBoundingClientRect();
    Object.assign(overlay.style, {top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px`});
  };
  const cleanup = () => { overlay.remove(); banner.remove(); document.removeEventListener('mousemove', move, true); document.removeEventListener('click', click, true); document.removeEventListener('keydown', key, true); };
  const click = async e => {
    if (e.target.closest('[data-evans-picker]')) return;
    e.preventDefault(); e.stopImmediatePropagation();
    try {
      const result = await chrome.runtime.sendMessage({type: 'PICKED', selector: selector(e.target)});
      banner.textContent = result?.ok ? 'Region saved. Return to Evans.' : result?.error || 'Unable to save region.';
      setTimeout(cleanup, 2000);
    } catch { banner.textContent = 'Unable to save. Pick the region again.'; setTimeout(cleanup, 3000); }
    document.removeEventListener('click', click, true);
  };
  const key = e => { if (e.key === 'Escape') cleanup(); };
  document.addEventListener('mousemove', move, true); document.addEventListener('click', click, true); document.addEventListener('keydown', key, true);
})();
