// Self-contained: this function also runs in the isolated world of a monitored tab.
export function extractDocument(options = {}, html) {
  const doc = html === undefined ? document : new DOMParser().parseFromString(html, 'text/html');
  const root = options.selector ? doc.querySelector(options.selector) : doc.body;
  if (!root) throw new Error(options.selector ? 'Selected region not found. Update the selector.' : 'No page content found.');
  const excluded = new Set();
  for (const selector of options.excludeSelectors || []) for (const el of root.querySelectorAll(selector)) excluded.add(el);
  const skip = 'script,style,noscript,svg,canvas,template,iframe,object,embed,input,textarea,select,[hidden],[data-evans-picker]';
  const block = /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|BR|DD|DIV|DL|DT|FIELDSET|FIGCAPTION|FIGURE|FOOTER|FORM|H[1-6]|HEADER|HR|LI|MAIN|NAV|OL|P|PRE|SECTION|TABLE|TR|UL)$/;
  const parts = [];
  let normalizedSlick = false;
  function walk(node) {
    if (node.nodeType === 3) { parts.push(node.nodeValue); return; }
    if (node.nodeType !== 1 || excluded.has(node) || node.matches(skip)) return;
    // Slick toggles aria-hidden as the carousel rotates and inserts clones for looping.
    const slickSlide = node.matches('.slick-track > .slick-slide');
    if (slickSlide ? node.classList.contains('slick-cloned') : node.matches('[aria-hidden="true"]')) return;
    if (html === undefined) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return;
    } else if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(node.getAttribute('style') || '')) return;
    if (slickSlide) normalizedSlick = true;
    const isBlock = block.test(node.tagName);
    if (isBlock) parts.push('\n');
    for (const child of node.childNodes) walk(child);
    if (isBlock) parts.push('\n');
    else parts.push(' ');
  }
  walk(root);
  let text = parts.join('').normalize('NFKC').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (options.ignoreNumbers) text = text.replace(/\d+/g, '#');
  for (const pattern of options.ignorePatterns || []) if (pattern) text = text.split(pattern).join('');
  if(options.ignoreTimestamps !== false) text = text.replace(/\b\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?(?:\s*[AP]M)?\b/gi, '[time]').replace(/\b\d+\s+(seconds?|minutes?|hours?)\s+ago\b/gi, '[relative time]');
  text = text.replace(/[ \t]+/g, ' ').trim();
  if (text.length > 1000000) throw new Error('Selected region exceeds 1 MB of text. Select a smaller region.');
  if (text.length < 10 || (text.length < 600 && /enable javascript|please wait|checking your browser|just a moment|verify you are human|access denied|captcha|loading\.{0,3}/i.test(text)))
    throw new Error('Page is empty, loading or blocked. Try rendered mode or check the site.');
  const pageUrl = html === undefined ? location.href : options.url;
  let faviconUrl;
  try {
    const base = new URL(doc.querySelector('base[href]')?.getAttribute('href') || pageUrl, pageUrl);
    const icon = doc.querySelector('link[rel~="icon" i][href]') || doc.querySelector('link[rel="apple-touch-icon" i][href]');
    const url = new URL(icon?.getAttribute('href') || '/favicon.ico', base);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) faviconUrl = url.href;
  } catch {}
  return {text, title: doc.title, url: html === undefined ? location.href : undefined, faviconUrl, normalizedSlick};
}
