import {all, get} from '../core/db.js';
import {createArchive} from '../core/archive.js';
import {parseBulk, canonicalUrl, prepareImport} from '../core/model.js';
import {comparisonFor, renderDiff} from './comparison.js';
import {icon} from './icons.js';
import {request, isExtension} from './bridge.js';
import {adjacentPageChange} from './navigation.js';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const shortDate = t => t ? new Intl.DateTimeFormat('en', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'}).format(t) : 'Never checked';
const fullDate = t => new Intl.DateTimeFormat('en', {dateStyle:'long', timeStyle:'short'}).format(t);
const intervals = [[300,'Every 5 minutes'],[900,'Every 15 minutes'],[3600,'Hourly'],[21600,'Every 6 hours'],[43200,'Every 12 hours'],[86400,'Daily'],[604800,'Weekly']];
const intervalName = n => intervals.find(v => v[0] === n)?.[1] || `Every ${Math.round(n / 60)} min`;
const options = (items, selected) => items.map(([v,l]) => `<option value="${esc(v)}" ${String(v) === String(selected) ? 'selected' : ''}>${esc(l)}</option>`).join('');
const state = {pages: [], changes: [], runs: [], settings: {}, active: null, view:'pages', query:'', filter:'unread', tag:'', sort:'name', selected:new Set(), page:0, changeId:null, changeFilter:'unread', changePage:'', runId:null, diffMode:'changes', changesPage:0, runsPage:0};
let refreshTimer, importFile, previousFocus, pointerPagePicker;
const main = $('#main'), dialog = $('#dialog');
// Read state is persisted immediately, but membership stays stable until navigation.
const heldReadChanges = new Set(), readingRequests = new Map();
let readingObserver;

function updateReadIndicators() {
  $('#unread-count').textContent = state.changes.filter(c => !c.read && !c.filtered).length || '';
  for (const item of main.querySelectorAll('.finding-item')) {
    item.querySelector('.unread-dot')?.classList.toggle('is-read', !!state.changes.find(c => c.id === item.dataset.id)?.read);
  }
  const current = state.changes.find(c => c.id === state.changeId);
  if (state.view === 'changes' && current) {
    const button = main.querySelector('[data-action="read-change"]');
    if (button) { button.disabled = current.read; button.setAttribute('aria-label', current.read ? 'Read' : 'Mark as read'); }
    const label = main.querySelector('.comparison-read-state');
    if (label) label.textContent = current.read ? 'Read' : '';
  }
}
async function markChangeRead(id) {
  if (readingRequests.has(id)) return readingRequests.get(id);
  const change = state.changes.find(c => c.id === id);
  if (!change || change.read) return;
  if (state.view === 'changes' && state.changeId === id) heldReadChanges.add(id);
  change.read = true;
  const page = pageById(change.pageId);
  if (page) page.unread = state.changes.filter(c => c.pageId === page.id && !c.read && !c.filtered).length;
  updateReadIndicators();
  const pending = (async () => {
    try { await request('READ', {ids:[id]}); }
    catch (error) {
      const current = state.changes.find(c => c.id === id);
      if (current) current.read = false;
      heldReadChanges.delete(id);
      const page = pageById(change.pageId);
      if (page) page.unread = state.changes.filter(c => c.pageId === page.id && !c.read && !c.filtered).length;
      updateReadIndicators();
      throw error;
    }
  })().finally(() => readingRequests.delete(id));
  readingRequests.set(id, pending);
  return pending;
}
function observeReadingEnd() {
  readingObserver?.disconnect();
  const end = main.querySelector('.diff-end');
  if (!end || state.view !== 'changes') return;
  const id = state.changeId;
  readingObserver = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting && entry.intersectionRatio === 1) && document.visibilityState === 'visible' && !dialog.open && state.view === 'changes' && state.changeId === id) {
      void markChangeRead(id).catch(error => toast(error.message, true));
    }
  }, {threshold:1});
  readingObserver.observe(end);
}
function leaveChange() { heldReadChanges.clear(); }
function selectChange(id) {
  if (id === state.changeId) return;
  leaveChange(); state.changeId = id;
  const list = filteredChanges();
  state.changesPage = Math.max(0, Math.floor(list.findIndex(c => c.id === id) / 50));
  render();
}

function focusComparison() {
  const frame = main.querySelector('.diff-content');
  frame?.focus({preventScroll:true});
  frame?.scrollIntoView({block:'nearest', inline:'nearest'});
}

function revealSelectedFinding() {
  const list = main.querySelector('.findings-list');
  const row = list?.querySelector('.finding-item.selected');
  if (!row) return;
  const bounds = list.getBoundingClientRect(), item = row.getBoundingClientRect();
  const offset = (start, end, min, max) => start < min ? start - min : Math.max(0, end - max);
  list.scrollBy({
    top: offset(item.top, item.bottom, bounds.top, bounds.top + list.clientHeight),
    left: offset(item.left, item.right, bounds.left, bounds.left + list.clientWidth),
    behavior:'instant',
  });
}

function toast(message, error = false) {
  const el = document.createElement('div'); el.className = `toast ${error ? 'error' : ''}`; el.textContent = message; $('#toasts').append(el); setTimeout(() => el.remove(), 5500);
}
async function act(type, data = {}, message) {
  const result = await request(type, data); if (message) toast(message); await refresh(); return result;
}
function pageById(id) { return state.pages.find(p => p.id === id); }
function pageAvatar(p) {
  const url = p?.url && new URL(p.url);
  const source = url && (p.faviconUrl || new URL('/favicon.ico', url).href);
  return `<span class="page-avatar" aria-hidden="true">${icon('globe')}${source ? `<img class="page-favicon" src="${esc(source)}" data-page-url="${esc(p.url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}</span>`;
}
function status(p) {
  if (!p.enabled) return '<span class="status muted"><span class="status-dot"></span>Paused</span>';
  const statuses = {pending:['muted','Awaiting baseline'], baseline:['good','Baseline saved'], changed:['plum','Changed'], unchanged:['good','Unchanged'], filtered:['muted','Filtered change'], error:['bad','Needs attention'], skipped:['muted','Skipped']};
  const [cls, text] = statuses[p.lastStatus] || statuses.pending;
  return `<span class="status ${cls}"><span class="status-dot"></span>${text}</span>`;
}
function route() {
  const [view, id] = location.hash.slice(1).split('/');
  if (view !== state.view) leaveChange();
  state.view = ['pages','changes','runs','settings'].includes(view) ? view : 'pages';
  if (view === 'changes' && id) { try { const changeId = decodeURIComponent(id); if (changeId !== state.changeId) leaveChange(); state.changeId = changeId; state.changeFilter = state.changes.find(c=>c.id===state.changeId)?.filtered ? 'filtered' : 'all'; state.changePage=''; } catch {} }
  render();
}
async function refresh() {
  const data = await request('STATUS');
  state.pages = data.pages.sort((a,b) => a.name.localeCompare(b.name) || a.url.localeCompare(b.url));
  state.settings = data.settings;
  if(state.settings.uiVersion!==2){await request('SETTINGS',{patch:{uiVersion:2}});state.settings.uiVersion=2;}
  [state.changes, state.runs] = await Promise.all([all('changes'), all('runs')]);
  for (const change of state.changes) if (readingRequests.has(change.id)) change.read = true;
  state.changes.sort((a,b) => b.timestamp - a.timestamp); state.runs.sort((a,b) => b.startedAt - a.startedAt);
  state.active = state.runs.find(r => r.id === data.activeRun?.runId && r.status === 'running');
  document.documentElement.dataset.theme = state.settings.theme === 'light' ? 'light' : 'dark';
  state.selected = new Set([...state.selected].filter(id => pageById(id)));
  render({preserveComparison:true});
}
function shellHeader(title, subtitle, actions = '') {
  return `${!isExtension ? '<div class="preview-notice">Preview only. Install the extension to enable monitoring.</div>' : ''}<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions">${actions}</div></div>${runBanner()}`;
}
function runBanner() {
  if (state.active) return `<div class="run-banner"><span class="scan-icon">${icon('refresh')}</span><div><strong>Check in progress</strong><span>${state.active.completed} of ${state.active.total} pages checked · ${state.active.changed} changed</span></div><progress value="${state.active.completed}" max="${state.active.total}" aria-label="Run progress"></progress><button class="text-button" data-action="stop">Stop</button></div>`;
  if (state.settings.paused) return `<div class="notice">${icon('pause')} Automatic checks are paused. <button class="text-button" data-action="global-resume">Resume</button></div>`;
  return '';
}
function render({preserveComparison = false} = {}) {
  const names = {pages:'Pages',changes:'Changes',runs:'Runs',settings:'Settings'};
  $('#breadcrumb').innerHTML = `Workspace <span>/</span> ${names[state.view]}`;
  document.querySelectorAll('[data-nav]').forEach(el => { const active = el.dataset.nav === state.view; el.classList.toggle('active', active); if (active) el.setAttribute('aria-current','page'); else el.removeAttribute('aria-current'); });
  $('#page-count').textContent = state.pages.length;
  const unread = state.changes.filter(c => !c.read && !c.filtered).length;
  $('#unread-count').textContent = unread || '';
  $('#theme-toggle').innerHTML = icon(state.settings.theme === 'dark' ? 'sun' : 'moon');
  if (preserveComparison && state.view === 'changes' && main.querySelector('.comparison')?.dataset.changeId === state.changeId && state.changes.some(c => c.id === state.changeId)) {
    if (state.changes.find(c => c.id === state.changeId)?.read) heldReadChanges.add(state.changeId);
    updateReadIndicators();
    return;
  }
  const listScroll = main.querySelector('.findings-list');
  const scroll = listScroll && {top:listScroll.scrollTop, left:listScroll.scrollLeft};
  const focus = document.activeElement, focusId = focus?.id, selection = focus?.selectionStart;
  const focusSelector = focus?.dataset.select ? `[data-select="${CSS.escape(focus.dataset.select)}"]` : focus?.dataset.action ? `[data-action="${CSS.escape(focus.dataset.action)}"]${focus.dataset.id ? `[data-id="${CSS.escape(focus.dataset.id)}"]` : focus.dataset.value ? `[data-value="${CSS.escape(focus.dataset.value)}"]` : ''}` : null;
  main.innerHTML = ({pages:renderPages, changes:renderChanges, runs:renderRuns, settings:renderSettings}[state.view])();
  if (focusId && document.getElementById(focusId)) { const next = document.getElementById(focusId); next.focus({preventScroll:true}); if (typeof selection === 'number' && next.type === 'search') next.setSelectionRange(selection, selection); }
  else if(focusSelector) document.querySelector(focusSelector)?.focus({preventScroll:true});
  if (state.view === 'settings') updateStorage();
  if (scroll && main.querySelector('.findings-list')) { main.querySelector('.findings-list').scrollTop = scroll.top; main.querySelector('.findings-list').scrollLeft = scroll.left; }
  observeReadingEnd();
}
function filteredPages() {
  const q = state.query.toLocaleLowerCase();
  return state.pages.filter(p => (!q || `${p.name} ${p.url} ${p.tags.join(' ')}`.toLocaleLowerCase().includes(q)) && (!state.tag || p.tags.includes(state.tag)) && (state.filter === 'all' || state.filter === 'unread' && p.unread > 0 || state.filter === 'errors' && p.lastStatus === 'error' || state.filter === 'paused' && !p.enabled || state.filter === 'pending' && p.lastStatus === 'pending'))
    .sort((a,b) => state.sort === 'recent' ? (b.lastChangedAt || 0) - (a.lastChangedAt || 0) : a.name.localeCompare(b.name));
}
function renderPages() {
  const pending = state.pages.filter(p => p.lastStatus === 'pending').length, filtered = filteredPages(), visible = filtered.slice(state.page * 50, (state.page + 1) * 50);
  const unreadPages = state.pages.filter(p => p.unread > 0).length;
  const lastRun = state.runs.find(r => r.status === 'complete');
  const tags = [...new Set(state.pages.flatMap(p => p.tags))].sort();
  const allVisibleSelected = visible.length > 0 && visible.every(p => state.selected.has(p.id));
  return shellHeader('Pages', `${state.pages.length} monitored pages`, `<button class="button" data-action="run" ${state.active ? 'disabled' : ''}>${icon('refresh')}Check now</button><button class="button primary" data-action="add">${icon('plus')}Add pages</button>`) +
  `<div class="overview-strip"><span><span class="status-dot good"></span>${state.pages.filter(p => p.enabled).length} active</span><a href="#changes">${icon('spark')} ${unreadPages} with unread changes ${icon('arrow')}</a><span class="overview-last">${lastRun ? `Last run: ${shortDate(lastRun.endedAt)}` : 'Per-page schedules'}</span></div>` +
  `${pending && !state.active ? `<section class="welcome-panel"><div class="welcome-symbol">${icon('target')}</div><div><h2>${pending === state.pages.length ? 'Initial baseline required' : `${pending} pages need a baseline.`}</h2><p>${state.changes.length ? '' : ''}The first check establishes a baseline.</p><small>Rendered mode uses up to ${state.settings.concurrency} temporary background tabs.</small></div><button class="button" data-action="baseline">Create baseline ${icon('arrow')}</button></section>` : ''}` +
  `<section class="page-section" aria-label="Monitored pages"><div class="section-toolbar"><div class="filter-tabs" aria-label="Filter pages">${[['unread','Unread',unreadPages],['all','All',state.pages.length],['errors','Errors',state.pages.filter(p=>p.lastStatus==='error').length],['paused','Paused',state.pages.filter(p=>!p.enabled).length]].map(([key,label,count]) => `<button class="filter-tab ${state.filter===key?'selected':''}" data-action="filter" data-value="${key}" aria-pressed="${state.filter===key}">${label}<span>${count}</span></button>`).join('')}</div><div class="table-tools"><label class="search-box">${icon('search')}<input id="page-search" type="search" placeholder="Search pages…" aria-label="Search pages" value="${esc(state.query)}"><kbd>/</kbd></label><select id="sort" aria-label="Sort pages">${options([['name','Name A–Z'],['recent','Latest change']],state.sort)}</select>${tags.length?`<select id="tag-filter" aria-label="Filter by tag"><option value="">All tags</option>${options(tags.map(t=>[t,t]),state.tag)}</select>`:''}</div></div>`+
  `${state.selected.size ? `<div class="bulk-toolbar"><strong>${state.selected.size} selected</strong><button class="text-button" data-action="bulk-run">${icon('refresh')}Check</button><button class="text-button" data-action="bulk-pause">${icon('pause')}Pause</button><button class="text-button" data-action="bulk-resume">${icon('play')}Resume</button><button class="text-button danger" data-action="bulk-delete">${icon('trash')}Delete</button><button class="text-button clear-selection" data-action="clear-selection">Cancel</button></div>`:''}`+
  `<div class="table-wrap"><table class="pages-table"><thead><tr><th class="check-cell"><input type="checkbox" id="select-visible" aria-label="Select visible pages" ${allVisibleSelected?'checked':''}></th><th>Page</th><th>Status</th><th>Interval</th><th>Last check</th><th class="row-actions-heading"><span class="sr-only">Actions</span></th></tr></thead><tbody>${visible.map(p=>`<tr class="${state.selected.has(p.id)?'is-selected':''}"><td class="check-cell"><input type="checkbox" data-select="${esc(p.id)}" aria-label="Select ${esc(p.name)}" ${state.selected.has(p.id)?'checked':''}></td><td><div class="page-cell">${pageAvatar(p)}<div><button class="page-name" data-action="page-history" data-id="${esc(p.id)}">${esc(p.name)}${p.unread?`<span class="unread-number">${p.unread}</span>`:''}</button><a class="page-url" href="${esc(p.url)}" target="_blank" rel="noreferrer">${esc(new URL(p.url).hostname.replace(/^www\./,''))}${icon('external')}</a>${p.tags.length?`<div class="inline-tags">${p.tags.map(t=>`<span>${esc(t)}</span>`).join('')}</div>`:''}</div></div></td><td title="${esc(p.error)}">${status(p)}</td><td class="subtle">${intervalName(p.intervalSeconds)}<span class="cell-secondary">${p.mode==='rendered'?'Rendered':'HTML only'}</span></td><td class="subtle date-cell">${shortDate(p.lastCheckedAt)}</td><td class="row-actions"><button class="icon-button" data-action="toggle-page" data-id="${esc(p.id)}" aria-label="${p.enabled?'Pause':'Resume'} ${esc(p.name)}">${icon(p.enabled?'pause':'play')}</button><button class="icon-button" data-action="edit" data-id="${esc(p.id)}" aria-label="Configure ${esc(p.name)}">${icon('edit')}</button></td></tr>`).join('')}</tbody></table></div>`+
  `${!visible.length ? empty('pages',state.pages.length?'No matching pages.':'No pages added.',state.pages.length?'Adjust your search or filter.':'Paste URLs or import a JSON file.',state.pages.length?'':'<button class="button primary" data-action="add">Add pages</button>'):''}`+
  `<div class="table-footer"><span>${filtered.length ? `${state.page*50+1}–${Math.min((state.page+1)*50,filtered.length)} of ${filtered.length} pages`:'0 pages'}<span class="footer-dot">·</span>No page limit</span><div>${filtered.length>50?`<button class="text-button" data-action="prev-page" ${!state.page?'disabled':''}>Previous</button><button class="text-button" data-action="next-page" ${(state.page+1)*50>=filtered.length?'disabled':''}>Next</button>`:''}<button class="text-button" data-action="add">${icon('plus')}Add more</button></div></div></section>`+
  ``;
}
function empty(symbol,title,body,action='') { return `<div class="empty-state">${icon(symbol)}<h2>${title}</h2><p>${body}</p>${action}</div>`; }
function filteredChanges(includePage = true) {
  return state.changes.filter(c=>(!includePage || !state.changePage || c.pageId===state.changePage) && (state.changeFilter==='filtered'?c.filtered:!c.filtered) && (state.changeFilter!=='unread'||!c.read||heldReadChanges.has(c.id)) && (state.changeFilter!=='read'||c.read));
}
function renderChanges() {
  const changes=filteredChanges();
  state.changesPage = Math.min(state.changesPage, Math.max(0, Math.ceil(changes.length / 50) - 1));
  const current=changes.find(c=>c.id===state.changeId)||changes[state.changesPage*50];
  state.changeId=current?.id || null;
  return shellHeader('Changes', '', `<button class="button" data-action="read-all">${icon('check')}Mark all read</button>`)+
  `<div class="changes-toolbar"><div class="filter-tabs">${[['unread','Unread'],['read','Read'],['all','All'],['filtered','Filtered']].map(([k,l])=>`<button class="filter-tab ${state.changeFilter===k?'selected':''}" data-action="change-filter" data-value="${k}" aria-pressed="${state.changeFilter===k}">${l}</button>`).join('')}</div><select id="change-page" aria-label="Changes by page"><option value="">All pages</option>${options(state.pages.map(p=>[p.id,p.name]),state.changePage)}</select><span class="subtle change-total">${changes.length} ${changes.length===1?'change':'changes'}</span></div>`+
  (changes.length?`<div class="findings-layout"><div class="findings-list" aria-label="Change history">${changes.slice(state.changesPage*50,(state.changesPage+1)*50).map(c=>{ const p=pageById(c.pageId);return `<button class="finding-item ${c.id===current?.id?'selected':''}" data-action="select-change" data-id="${esc(c.id)}" aria-pressed="${c.id===current?.id}"><span class="finding-top">${pageAvatar(p||{name:'?'})}<strong>${esc(p?.name||'Deleted page')}</strong>${!c.read?'<span class="unread-dot" aria-label="Unread"></span>':''}</span><span class="finding-time">${shortDate(c.timestamp)}${c.imported?' · Imported':''}</span><span class="finding-excerpt">${esc(excerpt(c))}</span><span class="finding-bottom"><span>${c.filtered?'Filtered by rules':`${comparisonFor(c).size.toLocaleString('en')} characters changed`}</span>${icon('chevron')}</span></button>`;}).join('')}${changes.length>50?`<div class="finding-pagination"><button class="text-button" data-action="prev-changes" ${state.changesPage===0?'disabled':''}>Previous</button><button class="text-button" data-action="next-changes" ${(state.changesPage+1)*50>=changes.length?'disabled':''}>Next</button></div>`:''}</div><article class="comparison" data-change-id="${esc(current.id)}" aria-label="Change details">${renderComparison(current)}</article></div>`:empty('spark',state.changeFilter==='unread'?'No unread changes.':state.changeFilter==='read'?'No read changes.':state.changeFilter==='filtered'?'No filtered changes.':'No changes yet.',state.changeFilter==='unread'?'':''));
}
function excerpt(c) { return comparisonFor(c).excerpt.slice(0,160); }
function renderComparison(c) {
  if(!c) return '';
  const p=pageById(c.pageId), changesOnly=state.diffMode==='changes', comparison=comparisonFor(c);
  const body=renderDiff(comparison,state.diffMode);
  return `<header class="comparison-header"><div><span class="detail-kicker">${c.imported?'Imported history':c.filtered?'Filtered change':'Change detected'}</span><h2>${esc(p?.name||'Deleted page')}</h2><p>${fullDate(c.timestamp)}</p></div><div class="comparison-actions">${!c.read?`<button class="icon-button" data-action="read-change" data-id="${esc(c.id)}" aria-label="Mark as read" aria-keyshortcuts="R">${icon('check')}</button>`:''}${p?`<a class="icon-button" href="${esc(p.url)}" target="_blank" rel="noreferrer" aria-label="Open ${esc(p.name)}">${icon('external')}</a>`:''}</div></header><div class="diff-toolbar"><span class="helper">↑ / ↓: scroll · n / p: next / previous page · r: mark as read · reaching the end marks as read</span><div class="segmented" aria-label="Comparison view">${[['diff','Comparison'],['changes','Changes only'],['before','Before'],['after','After']].map(([k,l])=>`<button class="${state.diffMode===k?'active':''}" data-action="diff-mode" data-value="${k}" aria-pressed="${state.diffMode===k}">${l}</button>`).join('')}</div></div><div class="diff-legend"><strong>${comparison.hunks.length} changed ${comparison.hunks.length===1?'section':'sections'}</strong><span class="diff-count-add">+ ${comparison.added} ${comparison.added===1?'line':'lines'}</span><span class="diff-count-remove">− ${comparison.removed} ${comparison.removed===1?'line':'lines'}</span>${c.matchedKeywords?.length?`<span class="keyword-matches">${esc(c.matchedKeywords.join(', '))}</span>`:''}</div><div class="diff-content structured-diff ${changesOnly?'changes-only':''}" tabindex="0" aria-label="${state.diffMode==='before'?'Before, removals highlighted':state.diffMode==='after'?'After, additions highlighted':'Highlighted changes'}">${body}<span class="diff-end" aria-hidden="true"></span></div><footer class="comparison-footer">${icon('shield')}Saved locally<span class="comparison-read-state" role="status">${c.read?'Read':''}</span></footer>`;
}
function renderRuns() {
  const selected=state.runs.find(r=>r.id===state.runId)||state.runs[0];
  if(selected) state.runId=selected.id;
  const names={running:'Running',complete:'Complete',cancelled:'Stopped',imported:'Imported'};
  return shellHeader('Runs', '', `<button class="button primary" data-action="run" ${state.active?'disabled':''}>${icon('refresh')}New run</button>`)+
  (state.runs.length?`<div class="runs-layout"><section class="runs-list" aria-label="Runs">${state.runs.slice(state.runsPage*50,(state.runsPage+1)*50).map(r=>`<button class="run-item ${r.id===selected.id?'selected':''}" data-action="select-run" data-id="${esc(r.id)}"><div><strong>${r.status==='imported'?'Imported history':r.source==='scheduled'?'Scheduled run':'Manual run'}</strong><span class="status ${r.errors?'bad':r.status==='running'?'plum':'muted'}">${names[r.status]||esc(r.status)}</span></div><time>${shortDate(r.startedAt)}</time><p>${r.completed}/${r.total} checked<span>·</span>${r.changed} changed<span>·</span>${r.errors} errors</p></button>`).join('')}${state.runs.length>50?`<div class="finding-pagination"><button class="text-button" data-action="prev-runs" ${state.runsPage===0?'disabled':''}>Previous</button><button class="text-button" data-action="next-runs" ${(state.runsPage+1)*50>=state.runs.length?'disabled':''}>Next</button></div>`:''}</section><section class="run-detail" id="run-detail" aria-label="Run results"><div class="loading-state">Loading results…</div></section></div>`:empty('history','No runs yet.','Run a check to record page results.'));
}
async function loadRunDetail() {
  if(state.view!=='runs'||!state.runId) return;
  const id=state.runId, r=state.runs.find(r=>r.id===id); if(!r) return;
  const checks=await all('checks','runId',id);
  const changes=state.changes.filter(c=>c.runId===id);
  if(state.runId!==id||!$('#run-detail')) return;
  const labels={changed:'Changed',unchanged:'Unchanged',baseline:'Baseline saved',filtered:'Filtered change',error:'Read error',skipped:'Settings changed'};
  $('#run-detail').innerHTML=`<div class="run-detail-heading"><span class="detail-kicker">${r.status==='imported'?'Imported file':'Run log'}</span><h2>${fullDate(r.startedAt)}</h2><p>${r.status==='imported'?'Imported changes only. Unchanged checks were not included.':`${r.completed} of ${r.total} pages checked${r.endedAt?' · Duration: '+Math.max(1,Math.round((r.endedAt-r.startedAt)/1000))+' s':''}`}</p></div>${r.status==='cancelled'?'<div class="import-note">Las pages pendientes no se revisaron. Sus resultados anteriores se conservan.</div>':''}<div class="pass-results">${checks.length?checks.map(c=>{const p=pageById(c.pageId);return `<div class="pass-result"><div>${pageAvatar(p||{name:'?'})}<div><strong>${esc(p?.name||'Deleted page')}</strong><span>${shortDate(c.timestamp)}</span></div></div><div class="pass-result-status"><span class="status ${c.status==='error'?'bad':c.status==='changed'?'plum':'muted'}"><span class="status-dot"></span>${labels[c.status]||esc(c.status)}</span>${c.error?`<p>${esc(c.error)}</p>`:''}${changes.some(v=>v.id===c.id)?`<button class="text-button" data-action="open-change" data-id="${esc(c.id)}">View comparison ${icon('arrow')}</button>`:''}</div></div>`;}).join(''):changes.length?changes.map(c=>`<button class="import-result" data-action="open-change" data-id="${esc(c.id)}"><strong>${esc(pageById(c.pageId)?.name||'Page')}</strong><span>${shortDate(c.timestamp)}</span>${icon('arrow')}</button>`).join(''):empty('history',r.status==='running'?'Check in progress.':'No page results.','Results appear as checks finish.')}</div>`;
}
function renderSettings() {
  return shellHeader('Settings', '')+
  `<div class="settings-layout"><form id="settings-form" class="settings-form"><section class="settings-section"><h2>Appearance</h2><div class="setting-row"><label for="theme-choice">Theme</label><select id="theme-choice" name="theme">${options([['dark','Dark'],['light','Light']],state.settings.theme)}</select></div></section><section class="settings-section"><h2>Monitoring</h2><div class="setting-row"><div><label for="auto-paused">Automatic checks</label><p>Requires Chrome running and the device awake.</p></div><select id="auto-paused" name="paused">${options([['false','Enabled'],['true','Paused']],String(state.settings.paused))}</select></div><div class="setting-row"><div><label for="default-interval">Default interval</label><p>Can be overridden per page.</p></div><select id="default-interval" name="defaultInterval">${options(intervals,state.settings.defaultInterval)}</select></div><div class="setting-row"><div><label for="concurrency">Concurrent pages</label><p>Lower values use less memory.</p></div><select id="concurrency" name="concurrency">${options([[1,'1 page'],[2,'2 pages'],[3,'3 pages'],[4,'4 pages']],state.settings.concurrency)}</select></div></section><section class="settings-section"><h2>Notifications</h2><div class="setting-row"><div><label for="notifications">Browser notifications</label><p>Page name, domain and a link to the change.</p></div><input type="checkbox" class="switch" id="notifications" name="notifications" ${state.settings.notifications?'checked':''}></div><button type="button" class="text-button" data-action="test-notification">${icon('bell')}Test notification</button></section><section class="settings-section"><h2>Storage</h2><div class="setting-row"><div><label for="retention">History retention</label><p>Changes and check results. Applied after the next run.</p></div><select id="retention" name="retentionDays">${options([[0,'Forever'],[30,'30 days'],[90,'90 days'],[365,'1 year']],state.settings.retentionDays)}</select></div><div class="setting-row"><div><strong>Browser storage</strong><p id="storage-usage">Calculating usage…</p></div><span class="status muted">No page limit</span></div><p class="helper">Storage capacity depends on available disk space.</p></section><div class="settings-save"><button class="button primary" type="submit">Save settings</button></div></form><aside class="settings-aside"><section class="backup-panel">${icon('download')}<h2>Backup</h2><p>Save your watch list and review journal in an Evans archive.</p><button class="button" data-action="export">Save archive</button><button class="text-button" data-action="import">${icon('upload')}Restore or migrate</button></section><div class="privacy-copy"><h3>Storage and permissions</h3><p>Data is stored in this browser. No analytics or remote accounts.</p><p>Rendered mode uses temporary background tabs and your site session. HTML mode does not execute page scripts.</p><p>Restrict site permissions in Chrome extension settings.</p></div></aside></div>`;
}
async function updateStorage() {
  const estimate=await navigator.storage.estimate();
  if($('#storage-usage')) $('#storage-usage').textContent=`${((estimate.usage||0)/1048576).toLocaleString('en',{maximumFractionDigits:1})} MB used`;
}

function openDialog(content, wide=false) {
  previousFocus=document.activeElement;
  dialog.className=wide?'wide-dialog':''; dialog.innerHTML=content; if(!dialog.open) dialog.showModal();
}
function closeDialog() { dialog.close(); previousFocus?.focus(); }
const dialogHead=(title,subtitle='')=>`<header class="dialog-heading"><div><h2 id="dialog-title">${title}</h2>${subtitle?`<p>${subtitle}</p>`:''}</div><button type="button" class="icon-button" data-action="close-dialog" aria-label="Close">${icon('close')}</button></header>`;
function showAdd(initial='') {
  importFile=null;
  openDialog(`${dialogHead('Add pages','')}<div class="dialog-tabs"><button class="selected" data-action="add">Paste URLs</button><button data-action="import">Import file</button>${isExtension?'<button data-action="open-tabs">Open tabs</button>':''}</div><form id="add-form"><div class="dialog-body"><label class="field-label" for="bulk-urls">URLs <span>One per line</span></label><textarea id="bulk-urls" name="urls" rows="7" placeholder="https://example.com/careers&#10;Page name | https://example.org/jobs" required spellcheck="false">${esc(initial)}</textarea><div class="bulk-feedback" id="bulk-feedback">Optional format: Name | URL</div><div class="form-grid"><label>Interval<select name="intervalSeconds">${options(intervals,state.settings.defaultInterval)}</select></label><label>Capture mode<select name="mode">${options([['rendered','Rendered · JavaScript'],['fetch','HTML only']],'rendered')}</select></label></div><label class="stacked-label">Shared tags<input name="tags" placeholder="Jobs, favorites…" maxlength="300"><span class="helper">Comma-separated.</span></label><p class="helper">Rendered mode uses temporary background tabs. First check creates a baseline.</p><p class="form-error" id="form-error" role="alert"></p></div><footer class="dialog-footer"><button type="button" class="button" data-action="close-dialog">Cancel</button><button class="button primary" id="add-submit" type="submit">${icon('plus')}Add pages</button></footer></form>`,true);
  updateBulkFeedback();
}
function updateBulkFeedback() {
  if(!$('#bulk-urls')) return;
  const {entries,invalid}=parseBulk($('#bulk-urls').value), seen=new Set(state.pages.map(p=>canonicalUrl(p.url))); let duplicates=0;
  for(const e of entries) {const key=canonicalUrl(e.url);if(seen.has(key))duplicates++;else seen.add(key);}
  $('#bulk-feedback').textContent=entries.length?`${entries.length-duplicates} new · ${duplicates} duplicates${invalid.length?' · Invalid lines: '+invalid.map(v=>v.line).join(', '):''}`:invalid.length?'Enter full URLs starting with https://.':'Optional format: Name | URL';
  $('#add-submit').disabled=!entries.length||invalid.length>0;
}
function showImport() {
  importFile=null;
  openDialog(`${dialogHead('Restore or migrate','Open an Evans archive or migrate an older backup.')}<div class="dialog-tabs"><button data-action="add">Paste URLs</button><button class="selected" data-action="import">Import file</button></div><form id="import-form"><div class="dialog-body"><label class="file-drop">${icon('upload')}<strong>Select JSON file</strong><span>Processed locally.</span><input type="file" id="import-file" accept=".json,application/json" required></label><div id="import-preview" class="import-preview"></div><p class="helper">Pages are merged by URL. History is retained; baselines are recreated. Current settings are preserved.</p><p class="form-error" id="form-error" role="alert"></p></div><footer class="dialog-footer"><button type="button" class="button" data-action="close-dialog">Cancel</button><button class="button primary" id="import-submit" type="submit" disabled>Import file</button></footer></form>`,true);
}
function showEdit(id) {
  const p=pageById(id); if(!p) return;
  openDialog(`${dialogHead('Page settings',esc(p.name))}<form id="edit-form" data-id="${esc(id)}"><div class="dialog-body"><div class="form-grid"><label>Name<input name="name" value="${esc(p.name)}" required maxlength="160"></label><label>Interval<select name="intervalSeconds">${options([...intervals,...(!intervals.some(v=>v[0]===p.intervalSeconds)?[[p.intervalSeconds,intervalName(p.intervalSeconds)]]:[])],p.intervalSeconds)}</select></label></div><label class="stacked-label">URL<input name="url" type="url" value="${esc(p.url)}" required></label><div class="form-grid"><label>Capture mode<select name="mode">${options([['rendered','Rendered'],['fetch','HTML only']],p.mode)}</select></label><label>Tags<input name="tags" value="${esc(p.tags.join(', '))}" maxlength="300"></label></div><div class="zone-heading"><label class="field-label" for="selector">Watch region</label><button type="button" class="text-button" data-action="pick" data-id="${esc(id)}">${icon('target')}Pick on page</button></div><input id="selector" name="selector" value="${esc(p.selector)}" placeholder="Entire page (or CSS selector)"><p class="helper">Changing capture settings resets the baseline on the next check.</p><details class="advanced-settings" ${p.keywords.length||p.excludeSelectors.length||p.ignoreNumbers||p.threshold?'open':''}><summary>Filters ${icon('down')}</summary><div class="advanced-content"><label class="stacked-label">Exclude selectors <span class="helper">One CSS selector per line, e.g. nav or footer.</span><textarea name="excludeSelectors" rows="2">${esc(p.excludeSelectors.join('\n'))}</textarea></label><label class="stacked-label">Keywords<input name="keywords" value="${esc(p.keywords.join(', '))}" placeholder="Engineer, remote…"><span class="helper">Comma-separated. Leave empty to match any change.</span></label><div class="form-grid"><label>Match keywords in<select name="keywordMode">${options([['any','Additions or removals'],['added','Additions only'],['removed','Removals only']],p.keywordMode)}</select></label><label>Minimum change (%)<input name="threshold" type="number" min="0" max="100" step="0.1" value="${p.threshold}"></label></div><label class="stacked-label">Ignore text<textarea name="ignorePatterns" rows="2" placeholder="One literal phrase per line">${esc(p.ignorePatterns.join('\n'))}</textarea></label><label class="checkbox-label"><input type="checkbox" name="ignoreTimestamps" ${p.ignoreTimestamps!==false?'checked':''}>Ignore clocks and relative timestamps</label><label class="checkbox-label"><input type="checkbox" name="ignoreNumbers" ${p.ignoreNumbers?'checked':''}>Ignore numbers</label><p class="helper">Also ignores prices and dates.</p></div></details><label class="checkbox-label"><input type="checkbox" name="notifications" ${p.notifications?'checked':''}>Notify for this page</label>${p.error?`<div class="error-detail">${icon('alert')}<span>${esc(p.error)}</span></div>`:''}<p class="form-error" id="form-error" role="alert"></p></div><footer class="dialog-footer"><button type="button" class="text-button danger" data-action="delete-page" data-id="${esc(id)}">${icon('trash')}Delete page</button><button class="button primary" type="submit">Save changes</button></footer></form>`,true);
}
function confirmDelete(ids) {
  openDialog(`${dialogHead(`Delete ${ids.length===1?'this page':ids.length+' pages'}`)}<div class="dialog-body"><p>Delete ${ids.length===1?esc(pageById(ids[0])?.name):'selected pages'} and their history from this browser. Export a backup in Settings first.</p></div><footer class="dialog-footer"><button class="button" data-action="close-dialog">Cancel</button><button class="button destructive" data-action="confirm-delete" data-ids="${esc(JSON.stringify(ids))}">Delete permanently</button></footer>`);
}
async function exportData() {
  const stores=['pages','changes','runs','checks'];
  const values=await Promise.all(stores.map(s=>all(s)));
  const data=createArchive({settings:state.settings,...Object.fromEntries(stores.map((s,i)=>[s,values[i]]))});
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=`evans-workspace-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Backup exported.');
}

document.addEventListener('click', async e=>{
  const button=e.target.closest('[data-action]');if(!button||button.disabled)return;
  const a=button.dataset.action,id=button.dataset.id;
  try {
    switch(a){
      case 'theme': await act('SETTINGS',{patch:{theme:state.settings.theme==='dark'?'light':'dark'}});break;
      case 'add':showAdd();break;
      case 'close-dialog':closeDialog();break;
      case 'import':showImport();break;
      case 'export':await exportData();break;
      case 'edit':showEdit(id);break;
      case 'run':await act('RUN',{},'Check started.');break;
      case 'baseline':await act('RUN',{ids:state.pages.filter(p=>p.enabled&&p.lastStatus==='pending').map(p=>p.id)},'Creating baseline.');break;
      case 'stop':await act('STOP',{},'Stopping after active checks finish.');break;
      case 'global-resume':await act('SETTINGS',{patch:{paused:false}},'Automatic checks resumed.');break;
      case 'filter':state.filter=button.dataset.value;state.page=0;state.selected.clear();render();break;
      case 'next-page':state.page++;render();break;
      case 'prev-page':state.page--;render();break;
      case 'next-changes':leaveChange();state.changeId=null;state.changesPage++;render();break;
      case 'prev-changes':leaveChange();state.changeId=null;state.changesPage--;render();break;
      case 'next-runs':state.runsPage++;render();break;
      case 'prev-runs':state.runsPage--;render();break;
      case 'reload':location.reload();break;
      case 'clear-selection':state.selected.clear();render();break;
      case 'bulk-pause':await act('BULK_UPDATE',{ids:[...state.selected],patch:{enabled:false}},'Pages paused.');break;
      case 'bulk-resume':await act('BULK_UPDATE',{ids:[...state.selected],patch:{enabled:true,nextCheckAt:Date.now()}},'Pages resumed.');break;
      case 'bulk-run':await act('RUN',{ids:[...state.selected]},'Selected pages queued.');break;
      case 'bulk-delete':confirmDelete([...state.selected]);break;
      case 'delete-page':confirmDelete([id]);break;
      case 'confirm-delete':await act('DELETE',{ids:JSON.parse(button.dataset.ids)},'Pages deleted.');closeDialog();break;
      case 'toggle-page':await act('UPDATE_PAGE',{page:{...pageById(id),enabled:!pageById(id).enabled}});break;
      case 'change-filter':leaveChange();state.changeId=null;state.changeFilter=button.dataset.value;state.changesPage=0;render();break;
      case 'select-change':selectChange(id);break;
      case 'open-change':leaveChange();state.changeFilter=state.changes.find(c=>c.id===id)?.filtered?'filtered':'all';state.changePage='';state.changeId=id;location.hash=`changes/${encodeURIComponent(id)}`;route();break;
      case 'page-history':leaveChange();state.changePage=id;state.changeFilter='all';state.changesPage=0;location.hash='changes';route();break;
      case 'read-all':leaveChange();await act('READ',{},'All changes marked as read.');leaveChange();render();break;
      case 'read-change':await markChangeRead(id);break;
      case 'diff-mode':state.diffMode=button.dataset.value;render();break;
      case 'select-run':state.runId=id;render();break;
      case 'pick':await request('PICK',{pageId:id});closeDialog();toast('Select a region in the opened tab.');break;
      case 'test-notification':await request('TEST_NOTIFICATION');toast('Notification sent. Check system permissions if it does not appear.');break;
      case 'open-tabs':{
        const tabs=await chrome.tabs.query({currentWindow:true});showAdd(tabs.filter(t=>/^https?:\/\//.test(t.url||'')).map(t=>`${(t.title||'').replace(/[\r\n|]/g,' ')} | ${t.url}`).join('\n'));break;
      }
    }
  } catch(error){toast(error.message,true);}
});
document.addEventListener('input',e=>{
  if(e.target.id==='page-search'){state.query=e.target.value;state.page=0;render();}
  if(e.target.id==='bulk-urls')updateBulkFeedback();
});
document.addEventListener('pointerdown', e => {
  // Return pointer users to the reader while preserving native keyboard selection.
  pointerPagePicker = e.target.closest('#change-page');
});
document.addEventListener('change',async e=>{
  const el=e.target;
  if(el.dataset.select){el.checked?state.selected.add(el.dataset.select):state.selected.delete(el.dataset.select);render();}
  if(el.id==='select-visible'){for(const p of filteredPages().slice(state.page*50,(state.page+1)*50))el.checked?state.selected.add(p.id):state.selected.delete(p.id);render();}
  if(el.id==='sort'){state.sort=el.value;render();}
  if(el.id==='tag-filter'){state.tag=el.value;state.page=0;render();}
  if(el.id==='change-page'){
    const focusReader = el === pointerPagePicker;
    pointerPagePicker = null;
    leaveChange();state.changeId=null;state.changePage=el.value;state.changesPage=0;render();
    if(focusReader) focusComparison();
  }
  if(el.id==='import-file'){
    try{
      const file=el.files[0]; if(!file)return;
      if(file.size>100*1024*1024)throw new Error('File exceeds 100 MB. Split the backup before importing.');
      importFile=JSON.parse(await file.text()); const preview=prepareImport(importFile,state.pages,state.settings);
      $('#import-preview').textContent=`${preview.pages.length} new pages · ${preview.duplicates} already watched · ${preview.changes.length} changes ready to import.`;
      $('#import-submit').disabled=false;$('#form-error').textContent='';
    }catch(error){importFile=null;$('#form-error').textContent=error.message;$('#import-submit').disabled=true;}
  }
});
document.addEventListener('submit',async e=>{
  if(!['add-form','edit-form','settings-form','import-form'].includes(e.target.id))return;
  e.preventDefault();const form=e.target, data=new FormData(form), submit=form.querySelector('[type="submit"]');submit.disabled=true;
  try{
    if(form.id==='add-form'){
      const {entries,invalid}=parseBulk(data.get('urls'));if(invalid.length||!entries.length)throw new Error('Check URLs before adding.');
      const tags=String(data.get('tags')).split(',').map(s=>s.trim()).filter(Boolean);
      const result=await request('ADD',{pages:entries.map(p=>({...p,tags,mode:data.get('mode'),intervalSeconds:Number(data.get('intervalSeconds'))}))});
      closeDialog();await refresh();toast(`${result.added} pages added${result.duplicates?` · ${result.duplicates} duplicates skipped`:''}.`);
    }
    if(form.id==='import-form'){
      if(!importFile)throw new Error('Select a valid file.');
      const result=await request('IMPORT',{data:importFile});closeDialog();await refresh();toast(`${result.added} pages imported · ${result.changes} changes retained · ${result.duplicates} duplicates.`);
    }
    if(form.id==='edit-form'){
      const split=(name,sep=',')=>String(data.get(name)||'').split(sep).map(v=>v.trim()).filter(Boolean);
      const selector=String(data.get('selector')||'').trim(), excludeSelectors=split('excludeSelectors','\n');
      for(const s of [selector,...excludeSelectors].filter(Boolean))try{document.querySelector(s);}catch{throw new Error(`Invalid CSS selector: ${s}`);}
      const page={...pageById(form.dataset.id),name:data.get('name'),url:data.get('url'),intervalSeconds:Number(data.get('intervalSeconds')),mode:data.get('mode'),tags:split('tags'),selector,excludeSelectors,keywords:split('keywords'),keywordMode:data.get('keywordMode'),threshold:Number(data.get('threshold')),ignoreTimestamps:data.has('ignoreTimestamps'),ignoreNumbers:data.has('ignoreNumbers'),ignorePatterns:split('ignorePatterns','\n'),notifications:data.has('notifications')};
      await request('UPDATE_PAGE',{page});closeDialog();await refresh();toast('Settings saved.');
    }
    if(form.id==='settings-form'){
      await act('SETTINGS',{patch:{theme:data.get('theme')==='light'?'light':'dark',paused:data.get('paused')==='true',defaultInterval:Number(data.get('defaultInterval')),concurrency:Number(data.get('concurrency')),notifications:data.has('notifications'),retentionDays:Number(data.get('retentionDays'))}},'Settings saved.');
    }
  }catch(error){if($('#form-error'))$('#form-error').textContent=error.message;else toast(error.message,true);}
  finally{submit.disabled=false;}
});
dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDialog();}});
document.addEventListener('keydown',e=>{if(e.key==='/'&&!dialog.open&&!['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)){e.preventDefault();$('#page-search')?.focus();}if(e.key==='Escape'&&!dialog.open&&state.selected.size){state.selected.clear();render();}});
window.addEventListener('hashchange',route);
document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
if(isExtension) chrome.runtime.onMessage.addListener(message=>{if(message.type==='UPDATED'&&!(state.view==='settings'&&document.activeElement?.closest('#settings-form'))){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>refresh().catch(e=>toast(e.message,true)),180);}});
// Avoid resetting an in-progress settings form; refresh run progress only while it is visible.
setInterval(()=>{if(state.active&&!dialog.open&&state.view!=='settings')void refresh().catch(()=>{});},2500);
const observer=new MutationObserver(()=>{if(state.view==='runs'&&$('#run-detail')?.querySelector('.loading-state'))void loadRunDetail();});
observer.observe(main,{childList:true});
try{
  await refresh();route();
  const params=new URLSearchParams(location.search), add=params.get('add');
  if(add){showAdd(add);params.delete('add');history.replaceState(null,'',location.pathname+(params.size?'?'+params:'')+location.hash);}
}catch(error){main.innerHTML=empty('alert','Unable to open dashboard.',esc(error.message),'<button class="button" data-action="reload">Retry</button>');}

document.addEventListener('keydown',e=>{
  if(e.target === pointerPagePicker) pointerPagePicker = null;
  if(e.defaultPrevented||e.isComposing||dialog.open||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)||e.target.isContentEditable||state.view!=='changes'||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey)return;
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){
    const frame=main.querySelector('.diff-content');if(!frame)return;
    e.preventDefault();frame.scrollBy({top:e.key==='ArrowDown'?64:-64,behavior:'instant'});return;
  }
  if(e.key!=='n'&&e.key!=='p'&&e.key!=='r')return;
  e.preventDefault();
  if(e.repeat)return;
  if(e.key==='r'){
    if(state.changeId) void markChangeRead(state.changeId).catch(error => toast(error.message, true));
    return;
  }
  const currentPageId=state.changes.find(c=>c.id===state.changeId)?.pageId||state.changePage;
  const next=adjacentPageChange(filteredChanges(false),currentPageId,e.key==='n'?1:-1);
  if(!next){
    if(e.key==='p') toast('No previous page with matching changes.');
    return;
  }
  if(state.changePage)state.changePage=next.pageId;
  selectChange(next.id);
  revealSelectedFinding();
  focusComparison();
});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')observeReadingEnd();});
dialog.addEventListener('close',observeReadingEnd);
document.addEventListener('load',e=>{if(e.target.matches?.('.page-favicon'))e.target.parentElement.classList.add('has-favicon');},true);
document.addEventListener('error', e => {
  const img=e.target;
  if(!img.matches?.('.page-favicon'))return;
  if(isExtension && !img.dataset.nativeFallback){
    img.dataset.nativeFallback='true';
    const url=new URL(chrome.runtime.getURL('/_favicon/'));
    url.searchParams.set('pageUrl',img.dataset.pageUrl);url.searchParams.set('size','32');img.src=url.href;
  }else { img.parentElement.classList.remove('has-favicon'); img.remove(); }
}, true);
