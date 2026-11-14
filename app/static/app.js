'use strict';
/* Emergency Hub Coordinator - front end */

// Colours and line styles come from the Settings page (saved on the server); these are fallbacks
let COLORS = {
  leader: '#7B2CBF', small_group_leader: '#1D6FD8', vulnerable: '#D62828',
  single: '#F28C28', hub_coordinator: '#1A9E77', none: '#8C8C8C',
};
let HUB_LINE_COLORS = ['#1A9E77', '#E7298A', '#1F78B4', '#D95F02', '#66A61E', '#7570B3',
  '#E6AB02', '#A6761D', '#17BECF', '#BC3F8F', '#386CB0', '#8C564B'];
let SETTINGS = {
  dot_size: 16, centre_line_color: '#1D2330', centre_line_width: 3.5, spoke_width: 1.6, spoke_manual_width: 2.2,
  spoke_opacity: 0.7, spoke_color_mode: 'per_hub', spoke_color: '#1A9E77',
};
const CENTRE_PICK = '__centre__';
const RESTART_MSG = 'The server is still running an older version. Close the black server window and open Emergency Hub again, then refresh this page.';
let settingsTab = 'org';     // which Settings tab is open
let settingsDraft = null;   // unsaved Settings form values while picking the centre on the map

let STATE = null;
let byId = {};
let statusKeys = [];
let statusLabel = {};
let markers = {};
let selectedId = null;
let selectedHh = null;    // key of the household shown in the drawer
let groups = {};          // household-dot key -> {key, ids, lat, lon}
let placingId = null;
let firstLoad = true;
let spiderIds = null;     // ids in the currently spiderfied cluster

const filters = loadPref('ehc.filters', {});
const prefs = loadPref('ehc.prefs', { network: true, cluster: true });

function loadPref(k, d) { try { return Object.assign(d, JSON.parse(localStorage.getItem(k) || '{}')); } catch (e) { return d; } }
function savePref(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fullName = (p) => `${p.first_name} ${p.last_name}`.trim() || '(no name)';
const miles = (km) => km == null ? '' : `${(km * 0.621371).toFixed(km < 1.6 ? 2 : 1)} mi`;
const located = (p) => p.lat != null && p.lon != null;
const isHub = (p) => p.statuses.includes('hub_coordinator');
const levels = () => (SETTINGS && SETTINGS.grouping_levels) || 1;
const hubTag = (p) => (isHub(p) ? (levels() > 1 ? ` <small>(hub L${p.hub_level || 1})</small>` : ' <small>(hub)</small>') : '');
const hubWord = (p) => (levels() > 1 ? `level ${p.hub_level || 1} hub coordinator` : 'hub coordinator');

// ------------------------------------------------------------------ map setup
const map = L.map('map', { zoomControl: true }).setView([51.0375, -2.274], 12);
// Street map squares come through the app, which keeps every square you view on this PC and uses that copy first
const streets = L.tileLayer('tiles/osm/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '&copy; OpenStreetMap contributors', className: 'tiles-streets' }).addTo(map);
const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19, attribution: 'Imagery &copy; Esri' });
L.control.layers({ 'Street map': streets, 'Satellite': satellite }, null, { position: 'topright' }).addTo(map);
L.control.scale({ imperial: true, metric: true, position: 'bottomleft' }).addTo(map);

const networkLayer = L.layerGroup().addTo(map);
const hubLayer = L.layerGroup().addTo(map);   // hub coordinators are never grouped into clusters
const plainLayer = L.layerGroup();
const clusterLayer = L.markerClusterGroup({
  showCoverageOnHover: false,
  zoomToBoundsOnClick: false,
  spiderfyOnMaxZoom: false,
  maxClusterRadius: 38,
  spiderfyDistanceMultiplier: 1.7,
  iconCreateFunction: clusterIcon,
});
let centreMarker = null;

clusterLayer.on('clusterclick', (e) => {
  const b = e.layer.getBounds();
  const same = b.getNorthEast().equals(b.getSouthWest());
  const targetZoom = same ? 99 : map.getBoundsZoom(b.pad(0.3));
  if (same || targetZoom >= 17 || targetZoom <= map.getZoom()) {
    e.layer.spiderfy();
  } else {
    e.layer.zoomToBounds({ padding: [60, 60] });
  }
});
clusterLayer.on('spiderfied', (e) => { spiderIds = e.markers.map((m) => m.options.pid); });
clusterLayer.on('unspiderfied', () => { spiderIds = null; });

map.on('click', (e) => {
  if (!placingId) return;
  const id = placingId;
  stopPlacing();
  if (id === CENTRE_PICK) {
    settingsDraft.centre.lat = +e.latlng.lat.toFixed(6);
    settingsDraft.centre.lon = +e.latlng.lng.toFixed(6);
    showSettings(settingsDraft);
    toast('Position picked - press Save to keep it');
    return;
  }
  saveContact(id, { location: { lat: e.latlng.lat, lng: e.latlng.lng, lon: e.latlng.lng } }, 'Position saved');
});

// ------------------------------------------------------------------ colour / filter logic
function shownStatuses(p) { return statusKeys.filter((k) => p.statuses.includes(k) && filters[k] !== false); }
function isVisible(p) {
  if (!p.statuses.length) return filters.none !== false;
  return shownStatuses(p).length > 0;
}
function colourKey(p) {
  const s = shownStatuses(p);
  if (s.length) return s[0];
  if (p.statuses.length) return statusKeys.find((k) => p.statuses.includes(k));
  return 'none';
}
function colourOf(p) { return COLORS[colourKey(p)]; }
function prioIndex(p) { const k = colourKey(p); const i = statusKeys.indexOf(k); return i < 0 ? 99 : i; }

function bestOf(people) {
  let best = people[0];
  people.forEach((p) => { if (prioIndex(p) < prioIndex(best)) best = p; });
  return best;
}
function groupPeople(g) { return g.ids.map((id) => byId[id]).filter(Boolean); }
function groupHasHub(g) { return groupPeople(g).some(isHub); }

function dotIcon(g) {
  const people = groupPeople(g);
  const hub = people.some(isHub);
  const cls = ['dot'];
  if (hub) cls.push('hub');
  if (people.every((p) => p.geo && p.geo.status === 'approx')) cls.push('approx');
  if (g.key === selectedHh || g.ids.includes(selectedId)) cls.push('selected');
  const base = SETTINGS.dot_size || 16;
  const s = hub ? base + 10 : base;
  const inner = hub ? base + 4 : base;
  const badge = people.length > 1 ? `<span class="hh-count">${people.length}</span>` : '';
  return L.divIcon({
    className: 'dot-icon', iconSize: [s, s], iconAnchor: [s / 2, s / 2],
    html: `<span class="${cls.join(' ')}" style="width:${inner}px;height:${inner}px;background:${colourOf(bestOf(people))}"></span>${badge}`,
  });
}

function householdTitle(people) {
  if (people.length === 1) return fullName(people[0]);
  const surnames = [...new Set(people.map((p) => p.last_name.trim()).filter(Boolean))];
  return surnames.length === 1 ? `${surnames[0]} household` : 'Household';
}

function groupTooltip(g) {
  const people = groupPeople(g);
  if (people.length === 1) {
    const p = people[0];
    return esc(fullName(p)) + hubTag(p);
  }
  return `<b>${esc(householdTitle(people))}</b> <small>(${people.length})</small><ul class="tip-list">${people.map((p) =>
    `<li><span class="swatch" style="background:${colourOf(p)}"></span>${esc(fullName(p))}${hubTag(p)}</li>`).join('')}</ul>`;
}
function refreshMarker(id) { const m = id && markers[id]; if (m) m.setIcon(dotIcon(m.options.group)); }

function clusterIcon(cluster) {
  const ms = cluster.getAllChildMarkers();
  let best = null;
  let bestI = 999;
  let people = 0;
  ms.forEach((m) => groupPeople(m.options.group).forEach((p) => {
    people += 1;
    const i = prioIndex(p); if (i < bestI) { bestI = i; best = p; }
  }));
  const n = ms.length;
  const size = n < 10 ? 32 : n < 50 ? 38 : 46;
  const col = best ? colourOf(best) : COLORS.none;
  return L.divIcon({
    className: 'cluster-icon', iconSize: [size, size],
    html: `<div class="cluster" style="width:${size}px;height:${size}px;background:${col}" title="${n} ${n === 1 ? 'address' : 'addresses'}, ${people} people - click to show">${n}</div>`,
  });
}

// ------------------------------------------------------------------ branding, theme and the central hub marker
function centreContactLines(c, links) {
  c = c || {};
  const out = [];
  if (c.landline) out.push(`Landline: ${links ? telLink(c.landline) : esc(c.landline)}`);
  if (c.mobile) out.push(`Mobile: ${links ? telLink(c.mobile) : esc(c.mobile)}`);
  if (c.email) out.push(`Email: ${links ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : esc(c.email)}`);
  if (c.other) out.push(esc(c.other).replace(/\n/g, '<br>'));
  return out;
}
// In dark mode a very dark line colour would vanish against the map, so it is drawn light instead
function mapIsDark() { return document.documentElement.dataset.map === 'dark'; }
function lineColour(c, dark = mapIsDark()) {
  if (!dark || !/^#[0-9a-f]{6}$/i.test(c || '')) return c;
  const n = parseInt(c.slice(1), 16);
  const lum = (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return lum < 0.25 ? '#E5E8EE' : c;
}
function centreSize() { return SETTINGS.centre_size || 34; }
function centreImage(st) {
  const imgs = (STATE && STATE.images) || {};
  if (st.centre_symbol === 'org_logo') return imgs.org_logo;
  if (st.centre_symbol === 'image') return imgs.centre_image;
  return null;
}
function centrePinHtml(st) {
  const size = st.centre_size || 34;
  const img = centreImage(st);
  const inner = img ? `<img src="${esc(img)}" alt="">`
    : `<span style="color:${esc(st.centre_star_color || '#FFD400')};font-size:${Math.round(size * 0.6)}px">&#9733;</span>`;
  return `<div class="centre-pin" style="width:${size}px;height:${size}px;background:${esc(st.centre_color || '#1D2330')}">${inner}</div>`;
}

// ---- accent colour: works out readable text colours and soft tints from one brand colour
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function rgbHex(r) { return '#' + r.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase(); }
function mix(a, b, t) { const x = hexRgb(a); const y = hexRgb(b); return rgbHex(x.map((v, i) => v + (y[i] - v) * t)); }
function luminance(h) {
  return hexRgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(a, b) { const l1 = luminance(a); const l2 = luminance(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }
function applyAccent(accent, theme) {
  if (!/^#[0-9a-f]{6}$/i.test(accent || '')) return;
  const dark = theme === 'dark';
  const bg = dark ? '#1A202B' : '#FFFFFF';
  const ink = contrast(accent, '#FFFFFF') >= contrast(accent, '#111111') ? '#FFFFFF' : '#111111';
  // a version of the accent that is readable as text/buttons on the page background
  let text = accent; let i = 0;
  while (contrast(text, bg) < 4.5 && i++ < 20) text = mix(text, dark ? '#FFFFFF' : '#000000', 0.12);
  const textInk = contrast(text, '#FFFFFF') >= contrast(text, '#111111') ? '#FFFFFF' : '#111111';
  const r = document.documentElement.style;
  r.setProperty('--accent', accent);
  r.setProperty('--accent-ink', ink);
  r.setProperty('--accent-2', text);
  r.setProperty('--accent-2-ink', textInk);
  r.setProperty('--accent-soft', mix(accent, bg, dark ? 0.78 : 0.9));
}
function previewAccent() {
  if (!settingsDraft) return;
  applyAccent(settingsDraft.settings.accent_color, settingsDraft.settings.theme === 'dark' ? 'dark' : document.documentElement.dataset.theme);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('ehc.theme', theme); } catch (e) { /* ignore */ }
  applyMapTheme((SETTINGS && SETTINGS.map_theme) || 'auto', theme);
  const dark = theme === 'dark';
  applyAccent((SETTINGS && SETTINGS.accent_color) || '#23395D', theme);
  $('btnTheme').innerHTML = dark ? '&#9728;' : '&#9790;';
  $('btnTheme').title = dark ? 'Switch to light mode' : 'Switch to dark mode';
}

function applyMapTheme(mapTheme, theme) {
  const m = mapTheme === 'light' || mapTheme === 'dark' ? mapTheme : (theme || document.documentElement.dataset.theme || 'light');
  document.documentElement.dataset.map = m;
  try { localStorage.setItem('ehc.map', m); } catch (e) { /* ignore */ }
}

function applyBranding() {
  const st = SETTINGS;
  const c = (STATE && STATE.centre) || {};
  const logo = STATE && STATE.images && STATE.images.org_logo;
  const showLogo = !!(st.show_org_logo && logo);
  const showName = !!(st.show_org_name && st.org_name);
  $('brandLogo').hidden = !showLogo;
  if (showLogo) $('brandLogo').src = logo;
  $('brandMark').hidden = showLogo;
  const centreText = `Centre: ${c.name || ''}${c.postcode_display ? ` (${c.postcode_display})` : ''}`;
  $('brandTitle').textContent = showName ? st.org_name : 'Emergency Hub Coordinator';
  $('brandSub').textContent = showName ? `Emergency Hub Coordinator \u00b7 ${centreText}` : centreText;
  document.title = showName ? `${st.org_name} - Emergency Hub Coordinator` : 'Emergency Hub Coordinator';
  applyTheme(st.theme === 'dark' ? 'dark' : 'light');
}

async function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  SETTINGS.theme = next;
  applyTheme(next);
  if (STATE) { renderMap(); renderStats(); }
  if (!STATE || !STATE.settings) return;
  try {
    await api('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { theme: next } }) });
  } catch (e) { toast(e.message, true); }
}

// ------------------------------------------------------------------ render
function hubColourMap() {
  const hubs = STATE.contacts.filter(isHub).sort((a, b) => fullName(a).localeCompare(fullName(b)));
  const m = {};
  hubs.forEach((h, i) => { m[h.id] = HUB_LINE_COLORS[i % HUB_LINE_COLORS.length]; });
  return m;
}

function renderMap() {
  const keepSpider = spiderIds;
  clusterLayer.clearLayers();
  plainLayer.clearLayers();
  networkLayer.clearLayers();
  hubLayer.clearLayers();
  markers = {};
  const target = prefs.cluster ? clusterLayer : plainLayer;
  if (prefs.cluster) { map.removeLayer(plainLayer); map.addLayer(clusterLayer); } else { map.removeLayer(clusterLayer); map.addLayer(plainLayer); }

  const c = STATE.centre;
  if (centreMarker) { map.removeLayer(centreMarker); centreMarker = null; }
  if (c && c.lat != null) {
    centreMarker = L.marker([c.lat, c.lon], {
      zIndexOffset: 2000,
      icon: L.divIcon({ className: 'centre-icon', iconSize: [centreSize(), centreSize()], html: centrePinHtml(SETTINGS) }),
    }).addTo(map).bindTooltip(`<b>${esc(c.name)}</b>${c.postcode_display ? '<br>' + esc(c.postcode_display) : ''}${centreContactLines(c, false).map((l) => '<br>' + l).join('')}`, { direction: 'top', offset: [0, -centreSize() / 2] });
  }

  // One dot per household: people with the same address (and position) share a dot
  groups = {};
  STATE.contacts.forEach((p) => {
    if (!located(p) || !isVisible(p)) return;
    const key = `${p.household}@${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
    if (!groups[key]) groups[key] = { key, ids: [], lat: p.lat, lon: p.lon };
    groups[key].ids.push(p.id);
  });
  const toAdd = [];
  Object.values(groups).forEach((g) => {
    g.ids.sort((a, b) => (isHub(byId[b]) - isHub(byId[a])) || fullName(byId[a]).localeCompare(fullName(byId[b])));
    const hub = groupHasHub(g);
    const m = L.marker([g.lat, g.lon], { icon: dotIcon(g), group: g, pid: g.ids[0], riseOnHover: true, zIndexOffset: hub ? 500 : 0 });
    m.bindTooltip(groupTooltip(g), { direction: 'top', offset: [0, -8], className: 'name-tip' });
    m.on('click', () => { if (g.ids.length === 1) openCard(g.ids[0]); else openHousehold(g.key); });
    g.ids.forEach((id) => { markers[id] = m; });
    if (hub) hubLayer.addLayer(m); else toAdd.push(m);
  });
  if (prefs.cluster) clusterLayer.addLayers(toAdd); else toAdd.forEach((m) => plainLayer.addLayer(m));

  if (prefs.network && c && c.lat != null) {
    const hubCol = hubColourMap();
    const activeHubs = new Set();
    const drawn = new Set();
    STATE.contacts.forEach((p) => {
      if (isHub(p) || !p.hub || !located(p) || !isVisible(p)) return;
      const h = byId[p.hub];
      if (!h || !located(h)) return;
      activeHubs.add(h.id);
      const lineKey = `${h.id}|${p.lat},${p.lon}|${p.hub_auto}`;
      if (drawn.has(lineKey)) return;
      drawn.add(lineKey);
      L.polyline([[h.lat, h.lon], [p.lat, p.lon]], {
        color: SETTINGS.spoke_color_mode === 'single' ? SETTINGS.spoke_color : hubCol[h.id],
        weight: p.hub_auto ? SETTINGS.spoke_width : SETTINGS.spoke_manual_width,
        opacity: SETTINGS.spoke_opacity, dashArray: p.hub_auto ? null : '5 4',
        interactive: false,
      }).addTo(networkLayer);
    });
    // a hub is drawn if it is shown, or anyone below it is shown; walk up the chain of groups
    STATE.contacts.filter((h) => isHub(h) && isVisible(h)).forEach((h) => activeHubs.add(h.id));
    [...activeHubs].forEach((id) => {
      let cur = byId[id]; let guard = 0;
      while (cur && isHub(cur) && cur.hub && byId[cur.hub] && guard++ < 10) { activeHubs.add(cur.hub); cur = byId[cur.hub]; }
    });
    STATE.contacts.filter((h) => isHub(h) && located(h)).forEach((h) => {
      if (!activeHubs.has(h.id)) return;
      const parent = h.hub && byId[h.hub];
      if (parent && located(parent)) {
        L.polyline([[parent.lat, parent.lon], [h.lat, h.lon]], {
          color: SETTINGS.spoke_color_mode === 'single' ? SETTINGS.spoke_color : hubCol[parent.id],
          weight: SETTINGS.subhub_line_width || 2.5, opacity: Math.min(1, (SETTINGS.spoke_opacity || 0.7) + 0.2),
          dashArray: h.hub_auto ? null : '7 5', interactive: false,
        }).addTo(networkLayer);
      } else {
        // level-1 hubs (and higher-level hubs with no group to join) link straight to the central hub
        L.polyline([[c.lat, c.lon], [h.lat, h.lon]], {
          color: lineColour(SETTINGS.centre_line_color), weight: SETTINGS.centre_line_width, opacity: 0.85, interactive: false,
          dashArray: (h.hub_level || 1) > 1 ? '8 6' : null,
        }).addTo(networkLayer);
      }
      if (!isVisible(h)) {   // hub filtered out: still mark the end of its lines
        L.circleMarker([h.lat, h.lon], { radius: 6, color: '#1d2330', weight: 2, fillColor: '#fff', fillOpacity: 1 })
          .bindTooltip(esc(fullName(h)) + hubTag(h), { direction: 'top', className: 'name-tip' })
          .on('click', () => openCard(h.id)).addTo(networkLayer);
      }
    });
  }

  // restore an open spider if the selected person was in it
  if (keepSpider && prefs.cluster && selectedId && markers[selectedId] && !isHub(byId[selectedId])) {
    const parent = clusterLayer.getVisibleParent(markers[selectedId]);
    if (parent && parent !== markers[selectedId] && parent.spiderfy) parent.spiderfy();
  }

  if (firstLoad) {
    firstLoad = false;
    const pts = STATE.contacts.filter(located).map((p) => [p.lat, p.lon]);
    if (c && c.lat != null) pts.push([c.lat, c.lon]);
    if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40], maxZoom: 14 });
    else if (c && c.lat != null) map.setView([c.lat, c.lon], 13);
  }
}

function renderLegend() {
  const items = statusKeys.map((k, i) => ({ k, label: statusLabel[k], prio: i + 1, n: STATE.contacts.filter((p) => p.statuses.includes(k)).length }));
  items.push({ k: 'none', label: 'No status', prio: '', n: STATE.contacts.filter((p) => !p.statuses.length).length });
  $('legend').innerHTML = items.map((it) => `
    <li><label>
      <span class="prio">${it.prio}</span>
      <input type="checkbox" data-k="${it.k}" ${filters[it.k] !== false ? 'checked' : ''}>
      <span class="swatch" style="background:${COLORS[it.k]}"></span>
      <span class="name">${esc(it.label)}</span>
      <span class="count">${it.n}</span>
    </label></li>`).join('');
  $('legend').querySelectorAll('input').forEach((cb) => cb.addEventListener('change', () => {
    filters[cb.dataset.k] = cb.checked; savePref('ehc.filters', filters); renderAll(false);
  }));
}

function renderStats() {
  const all = STATE.contacts;
  const onMap = all.filter(located).length;
  const shown = all.filter((p) => located(p) && isVisible(p)).length;
  const hubs = all.filter(isHub).length;
  const unassigned = all.filter((p) => !isHub(p) && !p.hub).length;
  const lu = STATE.last_upload;
  $('stats').innerHTML = `
    <div><b>${all.length}</b> contacts &middot; <b>${onMap}</b> on map &middot; <b>${shown}</b> shown</div>
    <div><b>${hubs}</b> hub coordinator${hubs === 1 ? '' : 's'} &middot; <b>${unassigned}</b> without a hub</div>
    <div>${lu ? `Last update: ${esc(fmtDate(lu.timestamp))}<br><span class="muted">${esc(lu.filename)}</span>` : 'No uploads yet'}</div>`;
  const bad = all.filter((p) => !located(p)).length;
  $('unmappedBadge').textContent = bad;
  $('unmappedBadge').classList.toggle('zero', bad === 0);
  const c = STATE.centre || {};
  if (STATE.settings) applyBranding();
  // network key in the sidebar follows the settings
  $('keyCentreName').textContent = c.name || 'Centre';
  $('keyCentreLine').style.borderTop = `${Math.max(1, SETTINGS.centre_line_width)}px solid ${lineColour(SETTINGS.centre_line_color, document.documentElement.dataset.theme === 'dark')}`;
  const spokeCol = SETTINGS.spoke_color_mode === 'single' ? SETTINGS.spoke_color : HUB_LINE_COLORS[0];
  $('keySpokeLine').style.borderTop = `${Math.max(1, SETTINGS.spoke_width)}px solid ${spokeCol}`;
  $('keySpokeLine').style.opacity = SETTINGS.spoke_opacity;
  $('keyManualLine').style.borderTop = `${Math.max(1, SETTINGS.spoke_manual_width)}px dashed ${spokeCol}`;
  $('keyManualLine').style.opacity = SETTINGS.spoke_opacity;
  $('keyHubRing').style.background = COLORS.hub_coordinator;
  $('keySubhubRow').hidden = levels() < 2;
  $('keySubhubLine').style.borderTop = `${Math.max(1, SETTINGS.subhub_line_width || 2.5)}px solid ${spokeCol}`;
  $('emptyState').hidden = all.length > 0;
  renderPrinted();
}

function renderAll(refreshCard = true) {
  renderLegend();
  renderMap();
  renderStats();
  runSearch();
  if (refreshCard && selectedId) {
    if (byId[selectedId]) renderCard(byId[selectedId]); else closeCard();
  } else if (refreshCard && selectedHh) {
    if (groups[selectedHh]) renderHousehold(groups[selectedHh]); else closeCard();
  }
}

function applyState(s) {
  STATE = s;
  if (!s.settings) setTimeout(() => toast(RESTART_MSG, true), 300);
  checkPageVersion(s.app_version);
  showUpdateNotice(s.update);
  const demo = !!s.demo;
  document.body.classList.toggle('demo', demo);
  $('demoBadge').hidden = !demo;
  $('btnLock').hidden = demo || !(s.security && s.security.encrypted);
  ['btnUpload', 'btnUpload2'].forEach((id) => {
    $(id).disabled = demo;
    $(id).title = demo ? 'Not available in the demo - turn the demo off in Settings to upload your real list' : '';
  });
  const csOn = !!(s.churchsuite && s.churchsuite.configured);
  $('btnSync').hidden = !csOn;
  $('btnUpload').classList.toggle('primary', !csOn);
  $('btnUpload').textContent = csOn ? 'Upload CSV' : 'Upload contacts CSV';
  if (s.settings) {
    SETTINGS = s.settings;
    COLORS = Object.assign({}, s.settings.status_colors);
    HUB_LINE_COLORS = s.settings.hub_palette.slice();
  }
  byId = {};
  s.contacts.forEach((p) => { byId[p.id] = p; });
  statusKeys = s.statuses.map((x) => x.key);
  statusLabel = Object.fromEntries(s.statuses.map((x) => [x.key, x.label]));
  statusLabel.none = 'No status';
  renderAll();
}

// ------------------------------------------------------------------ API
async function api(url, opts = {}) {
  const r = await fetch(url, opts);
  let data = null;
  try { data = await r.json(); } catch (e) { /* not json */ }
  if (r.status === 404 && url.startsWith('/api/')) throw new Error(RESTART_MSG);
  if (r.status === 423) { showLockScreen(); throw new Error('Locked'); }
  if (!r.ok) throw new Error((data && data.error) || `Request failed (${r.status})`);
  return data;
}
async function loadState() { applyState(await api('/api/state')); }

async function saveContact(id, body, msg) {
  try {
    const s = await api(`/api/contacts/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    applyState(s);
    if (msg) toast(msg);
    flashSaved();
  } catch (e) { toast(e.message, true); }
}

// ------------------------------------------------------------------ contact card
function showDrawer() {
  $('drawer').classList.add('open');
  document.body.classList.add('drawer-open');
  $('drawer').setAttribute('aria-hidden', 'false');
  $('drawer').scrollTop = 0;
}
function openHousehold(key) {
  const g = groups[key];
  if (!g) return;
  const prev = selectedId || (selectedHh && groups[selectedHh] && groups[selectedHh].ids[0]);
  selectedId = null;
  selectedHh = key;
  refreshMarker(prev); refreshMarker(g.ids[0]);
  renderHousehold(g);
  showDrawer();
}
function renderHousehold(g) {
  const people = groupPeople(g);
  const p0 = people[0];
  const addr = [p0.address1, p0.address2, p0.town, p0.county, p0.postcode].filter(Boolean).map(esc).join('<br>');
  const phones = [...new Set(people.map((p) => p.telephone).filter(Boolean))];
  const others = STATE.contacts.filter((x) => x.household === p0.household && !g.ids.includes(x.id));
  $('card').innerHTML = `<div class="card">
    <h3>${esc(householdTitle(people))}</h3>
    <div class="muted" style="margin-bottom:10px">${people.length} people at this address</div>
    <section><h4>Address</h4>
      <div class="addr">${addr}</div>
      ${phones.length ? `<dl class="kv"><dt>Telephone</dt><dd>${phones.map(telLink).join('<br>')}</dd></dl>` : ''}
    </section>
    <section><h4>People</h4>
      <ul class="hh-list">${people.map((p) => `<li data-open="${p.id}">
        <div class="hh-name"><span class="swatch" style="background:${colourOf(p)}"></span><b>${esc(fullName(p))}</b>
          <span class="muted hh-open">Open card &rsaquo;</span></div>
        <div class="chips">${p.statuses.length ? p.statuses.map(chip).join('') : '<span class="chip grey">No status</span>'}</div>
        <div class="muted hh-meta">${p.mobile ? 'Mobile ' + esc(p.mobile) + ' &middot; ' : ''}${isHub(p) ? esc(hubWord(p).replace(/^./, (x) => x.toUpperCase())) + (p.hub && byId[p.hub] ? ' &middot; in ' + esc(fullName(byId[p.hub])) + '&rsquo;s group' : '') : p.hub && byId[p.hub] ? 'Hub: ' + esc(fullName(byId[p.hub])) : 'No hub'}</div>
      </li>`).join('')}</ul>
      ${others.length ? `<p class="muted" style="font-size:12px">Also at this address but hidden by the legend filter: ${others.map((x) => esc(fullName(x))).join(', ')}</p>` : ''}
    </section>
  </div>`;
  $('card').querySelectorAll('[data-open]').forEach((el) => el.addEventListener('click', () => openCard(el.dataset.open)));
}

function openCard(id) {
  const prev = selectedId || (selectedHh && groups[selectedHh] && groups[selectedHh].ids[0]);
  selectedId = id;
  selectedHh = null;
  refreshMarker(prev); refreshMarker(id);
  renderCard(byId[id]);
  $('drawer').classList.add('open');
  document.body.classList.add('drawer-open');
  $('drawer').setAttribute('aria-hidden', 'false');
}
function closeCard() {
  fromTable = false;
  const prev = selectedId || (selectedHh && groups[selectedHh] && groups[selectedHh].ids[0]);
  selectedId = null;
  selectedHh = null;
  refreshMarker(prev);
  $('drawer').classList.remove('open');
  document.body.classList.remove('drawer-open');
  $('drawer').setAttribute('aria-hidden', 'true');
}

function chip(k) { return `<span class="chip" style="background:${COLORS[k]}">${esc(statusLabel[k])}</span>`; }
function telLink(n) { return n ? `<a href="tel:${esc(n.replace(/[^\d+]/g, ''))}">${esc(n)}</a>` : '<span class="muted">-</span>'; }

function hubOptions(p) {
  const asHub = isHub(p);
  const hubs = STATE.contacts.filter((h) => isHub(h) && h.id !== p.id && (!asHub || (h.hub_level || 1) < (p.hub_level || 1)));
  const dist = (h) => (located(p) && located(h)) ? haversine(p, h) : null;
  hubs.sort((a, b) => {
    const da = dist(a); const db = dist(b);
    if (da != null && db != null) return da - db;
    if (da != null) return -1; if (db != null) return 1;
    return fullName(a).localeCompare(fullName(b));
  });
  let autoLabel = asHub ? `Automatic: nearest level ${(p.hub_level || 1) - 1} hub` : 'Automatic: nearest hub';
  if (p.hub_auto && p.hub && byId[p.hub]) autoLabel = `Automatic: nearest - ${fullName(byId[p.hub])} (${miles(p.hub_km)})`;
  else if (!located(p)) autoLabel += ' (not possible - not on map)';
  const opts = [`<option value="">${esc(autoLabel)}</option>`];
  hubs.forEach((h) => {
    const d = dist(h);
    const lv = levels() > 1 ? ` [L${h.hub_level || 1}]` : '';
    opts.push(`<option value="${h.id}" ${p.hub_override === h.id ? 'selected' : ''}>${esc(fullName(h))}${lv}${d != null ? ' - ' + miles(d) : located(h) ? '' : ' (not on map)'}</option>`);
  });
  return { html: opts.join(''), count: hubs.length };
}

function haversine(a, b) {
  const R = 6371; const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r; const dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function renderCard(p) {
  if (!p) return;
  const addr = [p.address1, p.address2, p.town, p.county, p.postcode, p.country].filter(Boolean).map(esc).join('<br>');
  const geo = p.geo || {};
  let geoNote = '';
  if (geo.status === 'none') geoNote = `<div class="alert bad"><b>Not shown on the map:</b> ${esc(geo.note)}</div>`;
  else if (geo.status === 'approx') geoNote = `<div class="alert warn"><b>Approximate position:</b> ${esc(geo.note)}</div>`;
  else if (geo.status === 'manual') geoNote = `<div class="alert info">Position was set by hand on the map.</div>`;
  else if (geo.note) geoNote = `<div class="alert info">${esc(geo.note)}</div>`;

  const chips = p.statuses.length ? p.statuses.map(chip).join('') : '<span class="chip grey">No status</span>';
  const statusBoxes = statusKeys.map((k, i) => `
    <label><input type="checkbox" data-status="${k}" ${p.statuses.includes(k) ? 'checked' : ''}>
    <span class="swatch" style="background:${COLORS[k]}"></span> ${esc(statusLabel[k])}
    <span class="muted" style="margin-left:auto;font-size:11px">priority ${i + 1}</span></label>`).join('');

  let hubSection;
  if (isHub(p)) {
    const members = STATE.contacts.filter((m) => m.hub === p.id)
      .sort((a, b) => (isHub(b) - isHub(a)) || ((a.hub_km ?? 1e9) - (b.hub_km ?? 1e9)));
    const lv = p.hub_level || 1;
    let structure = '';
    if (levels() > 1) {
      const parent = p.hub && byId[p.hub];
      const o = lv > 1 ? hubOptions(p) : null;
      structure = `<div class="hub-structure">
        <label>Hub level <select id="hubLevelSelect">${Array.from({ length: levels() }, (_, i) => `<option value="${i + 1}" ${lv === i + 1 ? 'selected' : ''}>Level ${i + 1}${i === 0 ? ` (reports to ${esc(STATE.centre.name || 'the centre')})` : ` (in a level ${i} hub's group)`}</option>`).join('')}</select></label>
        ${lv > 1 ? (o.count ? `<label>In the group of <select id="hubSelect">${o.html}</select></label>`
          : `<div class="alert warn">There are no level ${lv - 1} hub coordinators yet, so ${esc(p.first_name)} links straight to ${esc(STATE.centre.name || 'the centre')} for now.</div>`) : ''}
        ${parent ? `<div class="row-btns"><button class="btn small" data-open="${parent.id}">Open ${esc(fullName(parent))}&rsquo;s card</button>
          ${parent.mobile || parent.telephone ? `<span class="muted" style="align-self:center">${telLink(parent.mobile || parent.telephone)}</span>` : ''}</div>` : ''}
      </div>`;
    }
    const subCount = members.filter(isHub).length;
    const cc = STATE.centre || {};
    const cLines = centreContactLines(cc, true);
    const reportCentre = !(p.hub && byId[p.hub]) ? `<div class="alert info report-to"><b>Reports back to ${esc(cc.name || 'the central hub')}</b>
      ${cLines.length ? '<br>' + cLines.join('<br>') : '<br><span class="muted">No contact details yet - add them in Settings.</span>'}</div>` : '';
    hubSection = `<section><h4>${levels() > 1 ? `Hub coordinator &middot; level ${lv}` : 'Hub coordinator'}</h4>
      ${structure}${reportCentre}
      <p style="margin:0 0 8px">Looking after <b>${members.length}</b> ${members.length === 1 ? 'person' : 'people'}${subCount ? ` (including ${subCount} hub coordinator${subCount === 1 ? '' : 's'})` : ''}${p.centre_km != null ? ` &middot; ${miles(p.centre_km)} from ${esc(STATE.centre.name)}` : ''}.</p>
      ${members.length ? `<ul class="member-list">${members.map((m) => `<li data-open="${m.id}"><span class="swatch" style="background:${colourOf(m)}"></span>
        ${esc(fullName(m))}${hubTag(m)}${m.hub_auto ? '' : ' <small class="muted">(chosen)</small>'}<span class="km">${miles(m.hub_km)}</span></li>`).join('')}</ul>` : '<p class="muted">Nobody assigned yet.</p>'}
      </section>`;
  } else {
    const o = hubOptions(p);
    const cur = p.hub && byId[p.hub];
    hubSection = `<section><h4>Hub coordinator</h4>
      ${o.count ? `<select id="hubSelect">${o.html}</select>` : '<div class="alert info">No hub coordinators yet. Tick &ldquo;Hub Coordinator&rdquo; on someone&rsquo;s card to create one.</div>'}
      ${cur ? `<div class="row-btns"><button class="btn small" data-open="${cur.id}">Open ${esc(fullName(cur))}&rsquo;s card</button>
        ${cur.mobile || cur.telephone ? `<span class="muted" style="align-self:center">${telLink(cur.mobile || cur.telephone)}</span>` : ''}</div>` : ''}
      </section>`;
  }

  const housemates = STATE.contacts.filter((x) => x.household === p.household && x.id !== p.id);
  const hhKey = markers[p.id] && markers[p.id].options.group.ids.length > 1 ? markers[p.id].options.group.key : null;
  const hhHtml = housemates.length ? `<div class="alert info hh-note">Lives with: ${housemates.map((x) =>
    `<button class="link" data-open-card="${x.id}">${esc(fullName(x))}</button>`).join(', ')}
    ${hhKey ? `<br><button class="link" id="btnHousehold">&lsaquo; Back to household</button>` : ''}</div>` : '';

  $('card').innerHTML = `<div class="card">
    ${fromTable ? '<button class="link back-table" id="btnBackTable">&lsaquo; Back to table</button>' : ''}
    <h3>${esc(fullName(p))}</h3>
    <div class="chips">${chips}</div>
    ${hhHtml}
    ${geoNote}
    <section><h4>Contact</h4>
      <div class="addr">${addr || '<span class="muted">No address</span>'}</div>
      <dl class="kv">
        <dt>Telephone</dt><dd>${telLink(p.telephone)}</dd>
        <dt>Mobile</dt><dd>${telLink(p.mobile)}</dd>
        <dt>Email</dt><dd>${p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : '<span class="muted">-</span>'}</dd>
        ${p.centre_km != null ? `<dt>Distance</dt><dd>${miles(p.centre_km)} from ${esc(STATE.centre.name)}</dd>` : ''}
      </dl>
      <div class="row-btns">
        ${located(p) ? '<button class="btn small" id="btnZoom">Zoom to on map</button>' : ''}
        <button class="btn small" id="btnPlace">${located(p) ? 'Move pin' : 'Place on map by hand'}</button>
        ${geo.status === 'manual' ? '<button class="btn small" id="btnUnplace">Use address again</button>' : ''}
      </div>
    </section>
    <section><h4>Statuses <span class="saved" id="savedFlag">Saved</span></h4>
      <div class="status-list">${statusBoxes}</div>
    </section>
    ${hubSection}
    <section><h4>Notes</h4>
      <textarea id="notes" placeholder="e.g. needs help with mobility, has a key-holder, no mobile signal...">${esc(p.notes)}</textarea>
      <div class="muted" style="font-size:12px;margin-top:4px">Statuses, hub choice and notes are kept when you upload a new CSV.</div>
    </section>
  </div>`;

  const card = $('card');
  card.querySelectorAll('[data-status]').forEach((cb) => cb.addEventListener('change', () => {
    const st = [...card.querySelectorAll('[data-status]')].filter((x) => x.checked).map((x) => x.dataset.status);
    saveContact(p.id, { statuses: st });
  }));
  card.querySelectorAll('[data-open]').forEach((el) => el.addEventListener('click', () => focusPerson(el.dataset.open)));
  if ($('btnBackTable')) $('btnBackTable').addEventListener('click', () => { closeCard(); showTable(); });
  card.querySelectorAll('[data-open-card]').forEach((el) => el.addEventListener('click', () => openCard(el.dataset.openCard)));
  if ($('btnHousehold')) $('btnHousehold').addEventListener('click', () => openHousehold(hhKey));
  const sel = $('hubSelect');
  if (sel) sel.addEventListener('change', () => saveContact(p.id, { hub_override: sel.value || null }, 'Hub coordinator updated'));
  const lvSel = $('hubLevelSelect');
  if (lvSel) lvSel.addEventListener('change', () => saveContact(p.id, { hub_level: +lvSel.value }, `Now a level ${lvSel.value} hub coordinator`));
  const notes = $('notes');
  notes.addEventListener('change', () => saveContact(p.id, { notes: notes.value }));
  if ($('btnZoom')) $('btnZoom').addEventListener('click', () => focusPerson(p.id));
  $('btnPlace').addEventListener('click', () => startPlacing(p.id));
  if ($('btnUnplace')) $('btnUnplace').addEventListener('click', () => saveContact(p.id, { location: null }, 'Re-located from address'));
}

function flashSaved() {
  const f = $('savedFlag');
  if (!f) return;
  f.classList.add('show');
  setTimeout(() => f.classList.remove('show'), 1200);
}

function focusPerson(id) {
  const p = byId[id];
  if (!p) return;
  closeModal();
  openCard(id);
  const m = markers[id];
  if (m) {
    if (prefs.cluster && !isHub(p)) clusterLayer.zoomToShowLayer(m, () => { map.panTo(m.getLatLng()); });
    else map.setView(m.getLatLng(), Math.max(map.getZoom(), 15));
  } else if (located(p)) {
    map.setView([p.lat, p.lon], 16);
    toast('This person is hidden by the legend filter');
  }
}

function startPlacing(id) {
  placingId = id;
  $('placingName').textContent = id === CENTRE_PICK ? (settingsDraft.centre.name || 'the central hub') : fullName(byId[id]);
  $('placingBanner').hidden = false;
  $('map').classList.add('placing');
}
function stopPlacing() {
  placingId = null;
  $('placingBanner').hidden = true;
  $('map').classList.remove('placing');
}

// ------------------------------------------------------------------ search
function runSearch() {
  const q = $('search').value.trim().toLowerCase();
  if (!q || !STATE) { $('results').innerHTML = ''; return; }
  const qn = q.replace(/\s+/g, '');
  const hits = STATE.contacts.filter((p) => {
    const hay = `${p.first_name} ${p.last_name} ${p.address1} ${p.address2} ${p.town}`.toLowerCase();
    return hay.includes(q) || p.postcode.toLowerCase().replace(/\s+/g, '').includes(qn);
  }).slice(0, 15);
  $('results').innerHTML = hits.length ? hits.map((p) => `<li data-id="${p.id}">
    <span class="swatch" style="background:${colourOf(p)}"></span>
    <div>${esc(fullName(p))}<small>${esc([p.address1, p.town, p.postcode].filter(Boolean).join(', '))}${located(p) ? '' : ' &middot; not on map'}</small></div></li>`).join('')
    : '<li class="muted">No matches</li>';
  $('results').querySelectorAll('li[data-id]').forEach((li) => li.addEventListener('click', () => focusPerson(li.dataset.id)));
}

// ------------------------------------------------------------------ modals
function openModal(title, html, toolsHtml = '', cls = '') {
  document.querySelector('#modalBack .modal').className = 'modal' + (cls ? ' ' + cls : '');
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = html;
  $('modalTools').innerHTML = toolsHtml;
  $('modalBack').hidden = false;
  $('modalBody').scrollTop = 0;
}
function closeModal() {
  $('modalBack').hidden = true;
  if (settingsDraft && STATE && STATE.settings) { settingsDraft = null; applyBranding(); }
}
function bindOpenRows(root) {
  root.querySelectorAll('[data-open]').forEach((el) => el.addEventListener('click', () => {
    if (byId[el.dataset.open]) focusPerson(el.dataset.open); else toast('This person is no longer in the database');
  }));
}
function fmtDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function addrLine(p) { return esc([p.address1, p.address2, p.town, p.postcode].filter(Boolean).join(', ')); }
function chipsFor(statuses) { return statuses.length ? statuses.map((k) => chip(k)).join(' ') : '<span class="muted">-</span>'; }

// ---- changes report
async function showReports(selectId) {
  let reports;
  try { reports = await api('/api/reports'); } catch (e) { toast(e.message, true); return; }
  if (!reports.length) { openModal('Changes report', '<p class="muted">No CSV has been uploaded yet.</p>'); return; }
  const cur = reports.find((r) => r.id === selectId) || reports[0];
  const tabs = `<ul class="report-list">${reports.map((r) => `<li><button data-rep="${r.id}" class="${r.id === cur.id ? 'active' : ''}">${esc(fmtDate(r.timestamp))} &middot; ${esc(r.filename)}</button></li>`).join('')}</ul>`;
  openModal('Changes report', tabs + renderReport(cur), '<button class="btn small" id="btnPrint">Print</button>');
  $('modalBody').querySelectorAll('[data-rep]').forEach((b) => b.addEventListener('click', () => showReports(b.dataset.rep)));
  bindOpenRows($('modalBody'));
  $('btnPrint').addEventListener('click', printModal);
}

function renderReport(r) {
  const sec = (title, n, body) => `<h3>${title} <span class="count-pill">${n}</span></h3>${n ? body : '<p class="muted">None</p>'}`;
  let h = `<p class="muted">${/^ChurchSuite/.test(r.filename) ? '' : 'Upload of '}<b>${esc(r.filename)}</b> on ${esc(fmtDate(r.timestamp))}: ${r.rows} people ${/^ChurchSuite/.test(r.filename) ? 'fetched' : 'in the file'};
    database went from ${r.before} to ${r.after} people. This report shows the position at the time of upload.</p>
    <div class="summary-tiles">
      <div class="tile add"><div class="n">${r.added.length}</div><div class="l">New people</div></div>
      <div class="tile rem"><div class="n">${r.removed.length}</div><div class="l">Removed</div></div>
      <div class="tile upd"><div class="n">${r.updated.length}</div><div class="l">Details changed</div></div>
      <div class="tile"><div class="n">${r.hub_changes.length}</div><div class="l">Hub changes</div></div>
      <div class="tile warn"><div class="n">${r.not_located.length}</div><div class="l">Not on map</div></div>
    </div>`;
  h += r.warnings.map((w) => `<div class="alert warn">${esc(w)}</div>`).join('');
  h += sec('New people', r.added.length, `<table class="data"><tr><th>Name</th><th>Hub coordinator assigned</th><th>Location</th></tr>
    ${r.added.map((a) => `<tr class="clickable" data-open="${a.id}"><td>${esc(a.name)}</td>
      <td>${a.hub ? `${esc(a.hub)} <span class="muted">(${miles(a.hub_km)})</span>` : '<span class="muted">None - no hub available</span>'}</td>
      <td>${a.located ? (a.note ? `<span class="muted">${esc(a.note)}</span>` : 'On map') : `<span style="color:var(--danger)">${esc(a.note)}</span>`}</td></tr>`).join('')}</table>`);
  h += sec('Removed (not in this upload)', r.removed.length, `<table class="data"><tr><th>Name</th><th>Statuses they had</th><th>Address</th></tr>
    ${r.removed.map((a) => `<tr><td>${esc(a.name)}${a.assigned_count ? `<br><small style="color:var(--danger)">Was hub for ${a.assigned_count} people - they have been re-assigned</small>` : ''}</td>
      <td>${chipsFor(a.statuses)}</td><td>${esc(a.address)}</td></tr>`).join('')}</table>`);
  h += sec('Details changed', r.updated.length, `<table class="data"><tr><th>Name</th><th>Changes</th></tr>
    ${r.updated.map((u) => `<tr class="clickable" data-open="${u.id}"><td>${esc(u.name)}</td><td><ul class="changes">
      ${u.changes.map((c) => `<li><b>${esc(c.field)}:</b> <span class="old">${esc(c.old) || '(blank)'}</span> &rarr; <span class="new">${esc(c.new) || '(blank)'}</span></li>`).join('')}</ul></td></tr>`).join('')}</table>`);
  h += sec('Hub coordinator changes for existing people', r.hub_changes.length, `<table class="data"><tr><th>Name</th><th>From</th><th>To</th><th>Why</th></tr>
    ${r.hub_changes.map((c) => `<tr class="clickable" data-open="${c.id}"><td>${esc(c.name)}</td><td>${esc(c.old_hub || '-')}</td><td>${esc(c.new_hub || '-')}</td><td class="muted">${esc(c.why)}</td></tr>`).join('')}</table>`);
  h += sec('Not on the map after this upload', r.not_located.length, `<table class="data"><tr><th>Name</th><th>Reason</th></tr>
    ${r.not_located.map((a) => `<tr class="clickable" data-open="${a.id}"><td>${esc(a.name)}</td><td>${esc(a.note)}</td></tr>`).join('')}</table>`);
  if (r.approx && r.approx.length) {
    h += sec('Approximate positions (please check)', r.approx.length, `<table class="data"><tr><th>Name</th><th>Note</th></tr>
      ${r.approx.map((a) => `<tr class="clickable" data-open="${a.id}"><td>${esc(a.name)}</td><td>${esc(a.note)}</td></tr>`).join('')}</table>`);
  }
  return h;
}

// ---- not on map
function showUnmapped() {
  const none = STATE.contacts.filter((p) => !located(p));
  const approx = STATE.contacts.filter((p) => p.geo && p.geo.status === 'approx');
  const manual = STATE.contacts.filter((p) => p.geo && p.geo.status === 'manual');
  const table = (rows, noteHead) => `<table class="data"><tr><th>Name</th><th>Address on file</th><th>${noteHead}</th></tr>
    ${rows.map((p) => `<tr class="clickable" data-open="${p.id}"><td>${esc(fullName(p))}<br>${chipsFor(p.statuses)}</td>
      <td>${addrLine(p) || '<span class="muted">(none)</span>'}</td><td>${esc((p.geo && p.geo.note) || '')}</td></tr>`).join('')}</table>`;
  let h = `<p class="muted">Click a person to open their card. You can then fix the address in your church database (it will update on the next upload), or use <b>Place on map by hand</b>.</p>`;
  h += `<h3>Not displayed <span class="count-pill">${none.length}</span></h3>` + (none.length ? table(none, 'Reason') : '<p class="muted">Everyone with an address is on the map.</p>');
  h += `<h3>Approximate positions - please check <span class="count-pill">${approx.length}</span></h3>` + (approx.length ? table(approx, 'Note') : '<p class="muted">None</p>');
  if (manual.length) h += `<h3>Placed by hand <span class="count-pill">${manual.length}</span></h3>` + table(manual, 'Note');
  openModal('People not on the map', h, '<button class="btn small" id="btnRetry">Retry locating</button> <button class="btn small" id="btnPrint">Print</button>');
  bindOpenRows($('modalBody'));
  $('btnPrint').addEventListener('click', printModal);
  $('btnRetry').addEventListener('click', async () => {
    busy(true, 'Looking up addresses again...');
    try {
      const r = await api('/api/regeocode', { method: 'POST' });
      await loadState();
      toast(`Checked ${r.checked}; ${r.newly_located} newly located`);
      showUnmapped();
    } catch (e) { toast(e.message, true); } finally { busy(false); }
  });
}

// ---- hub groups
const collapsedHubs = new Set();
// tree order: each level-1 hub followed by the hubs in its group, and so on down
function hubsInTreeOrder() {
  const allHubs = STATE.contacts.filter(isHub).sort((a, b) => fullName(a).localeCompare(fullName(b)));
  const hubs = [];
  const depth = {};
  const visit = (hb, d) => {
    if (depth[hb.id] != null) return;
    depth[hb.id] = d; hubs.push(hb);
    allHubs.filter((x) => x.hub === hb.id).forEach((x) => visit(x, d + 1));
  };
  allHubs.filter((x) => !x.hub || !byId[x.hub] || !isHub(byId[x.hub])).forEach((x) => visit(x, 0));
  allHubs.forEach((x) => visit(x, 0));
  return { hubs, depth };
}

// ---- "Call lists last printed" (sidebar and Hub groups)
function printedInfo() {
  const cp = STATE && STATE.calls_printed;
  if (!cp) return { date: 'Never', warn: 'The call lists have not been confirmed as printed yet.' };
  const d = new Date(cp.at);
  const date = isNaN(d) ? cp.at : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const days = Math.floor((Date.now() - d) / 86400000);
  const ago = isNaN(days) ? '' : days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  return { date: ago ? `${date} (${ago})` : date,
    warn: cp.changed ? 'Contacts have changed since then - the paper lists are out of date.' : '' };
}
function renderPrinted() {
  const inf = printedInfo();
  $('printedDate').textContent = inf.date;
  $('printedWarn').textContent = inf.warn;
  $('printedWarn').hidden = !inf.warn;
  const m = $('hubPrinted');
  if (m) m.innerHTML = `Call lists last printed: <b>${esc(inf.date)}</b>${inf.warn ? ` <span class="printed-warn-inline">${esc(inf.warn)}</span>` : ''}`;
}
function printAllCallLists() {
  const { hubs } = hubsInTreeOrder();
  if (!hubs.length) { toast('There are no hub coordinators yet, so there are no call lists to print.', true); return; }
  printCallLists(hubs.map((x) => x.id), true);
}
async function confirmPrinted() {
  try {
    applyState(await api('/api/calls-printed', { method: 'POST' }));
    toast('Recorded: call lists printed today.');
  } catch (e) { toast(e.message, true); }
}

function showHubGroups() {
  const { hubs, depth } = hubsInTreeOrder();
  const hubCol = hubColourMap();
  const memberTable = (ms) => `<table class="data"><tr><th>Name</th><th>Statuses</th><th>Telephone</th><th>Mobile</th><th>Address</th><th>Distance</th></tr>
    ${ms.map((m) => `<tr class="clickable${isHub(m) ? ' subhub-row' : ''}" data-open="${m.id}"><td>${esc(fullName(m))}${hubTag(m)}${m.hub_auto ? '' : ' <small class="muted">(chosen)</small>'}</td>
      <td>${chipsFor(m.statuses)}</td><td>${esc(m.telephone)}</td><td>${esc(m.mobile)}</td><td>${addrLine(m)}</td><td>${miles(m.hub_km)}</td></tr>`).join('')}</table>`;
  let h = '<div class="hub-printed" id="hubPrinted"></div>';
  if (!hubs.length) h += '<div class="alert info">No hub coordinators yet. Open a person&rsquo;s card and tick &ldquo;Hub Coordinator&rdquo;.</div>';
  hubs.forEach((hb) => {
    const ms = STATE.contacts.filter((m) => m.hub === hb.id).sort((a, b) => (isHub(b) - isHub(a)) || ((a.hub_km ?? 1e9) - (b.hub_km ?? 1e9)));
    const parent = hb.hub && byId[hb.hub];
    const lvInfo = levels() > 1 ? `<span class="chip lvl-chip">Level ${hb.hub_level || 1}</span>${parent ? `<span class="muted">in ${esc(fullName(parent))}&rsquo;s group</span>` : ''}` : '';
    h += `<div class="hub-block${collapsedHubs.has(hb.id) ? ' collapsed' : ''}" data-hub="${hb.id}" style="margin-left:${Math.min(depth[hb.id], 4) * 28}px"><div class="hub-head" title="Click to show or hide this group">
      <span class="chev">&#9662;</span>
      <span class="swatch" style="background:${hubCol[hb.id]}"></span>
      <b class="link" data-open="${hb.id}">${esc(fullName(hb))}</b>${lvInfo}
      <span class="muted">${esc([hb.mobile, hb.telephone].filter(Boolean).join(' / '))}</span>
      <span class="muted">${addrLine(hb)}</span>
      <span class="count-pill" style="margin-left:auto">${ms.length} ${ms.length === 1 ? 'person' : 'people'}</span>
      <button type="button" class="btn small" data-print-hub="${hb.id}" title="Print this call list on its own">&#128438; Print</button>
      ${located(hb) ? '' : '<span class="chip" style="background:var(--danger)">Not on map</span>'}
    </div><div class="hub-body">${ms.length ? memberTable(ms) : '<p class="muted" style="padding:0 12px">Nobody assigned.</p>'}</div></div>`;
  });
  const orphans = STATE.contacts.filter((p) => !isHub(p) && !p.hub);
  if (hubs.length || orphans.length) {
    h += `<h3>Not assigned to any hub <span class="count-pill">${orphans.length}</span></h3>` +
      (orphans.length ? memberTable(orphans) + '<p class="muted">These people are not on the map, so a nearest hub can&rsquo;t be worked out. Choose a hub on their card.</p>' : '<p class="muted">Everyone is assigned.</p>');
  }
  openModal(`Hub groups (${hubs.length})`, h,
    '<button class="btn small" id="btnExpandAll">Expand all</button> <button class="btn small" id="btnCollapseAll">Collapse all</button> ' +
    `<label class="print-maps"><input type="checkbox" id="chkPrintMaps" ${prefs.printMaps !== false ? 'checked' : ''}> Include maps</label>` +
    '<button class="btn small" id="btnPrint">Print call lists</button> ' +
    '<button class="btn small" id="btnConfirmPrinted" title="Record today as the date the paper lists were printed and handed out">&#10003; Confirm call lists printed</button>');
  $('btnConfirmPrinted').addEventListener('click', confirmPrinted);
  renderPrinted();
  $('chkPrintMaps').addEventListener('change', (e) => { prefs.printMaps = e.target.checked; savePref('ehc.prefs', prefs); });
  bindOpenRows($('modalBody'));
  const blocks = [...$('modalBody').querySelectorAll('.hub-block')];
  const setCollapsed = (blk, on) => {
    blk.classList.toggle('collapsed', on);
    if (on) collapsedHubs.add(blk.dataset.hub); else collapsedHubs.delete(blk.dataset.hub);
  };
  blocks.forEach((blk) => blk.querySelector('.hub-head').addEventListener('click', (e) => {
    if (e.target.closest('[data-open]') || e.target.closest('[data-print-hub]')) return;   // name opens their card; Print prints
    setCollapsed(blk, !blk.classList.contains('collapsed'));
  }));
  $('btnExpandAll').addEventListener('click', () => blocks.forEach((b) => setCollapsed(b, false)));
  $('btnCollapseAll').addEventListener('click', () => blocks.forEach((b) => setCollapsed(b, true)));
  $('btnPrint').addEventListener('click', () => printCallLists(hubs.map((x) => x.id), true));
  $('modalBody').querySelectorAll('[data-print-hub]').forEach((b) => b.addEventListener('click', () => printCallLists([b.dataset.printHub], false)));
}

// ------------------------------------------------------------------ printed call lists (one hub per page)
// ---- a street map of one hub's group for the printed call list (numbers match the list)
async function renderHubMap(hb, ms, colour) {
  const pts = [hb, ...ms].filter(located);
  if (!pts.length) return null;
  const Wpx = 1100; const Hpx = 640; const pad = 55;
  const proj = (lat, lon, z) => {
    const sc = 256 * 2 ** z; const sn = Math.sin(lat * Math.PI / 180);
    return [(lon + 180) / 360 * sc, (0.5 - Math.log((1 + sn) / (1 - sn)) / (4 * Math.PI)) * sc];
  };
  let z = 17; let xy;
  for (; z > 6; z--) {
    xy = pts.map((p) => proj(p.lat, p.lon, z));
    const xs = xy.map((q) => q[0]); const ys = xy.map((q) => q[1]);
    if (Math.max(...xs) - Math.min(...xs) <= Wpx - 2 * pad && Math.max(...ys) - Math.min(...ys) <= Hpx - 2 * pad) break;
  }
  xy = pts.map((p) => proj(p.lat, p.lon, z));
  const xs = xy.map((q) => q[0]); const ys = xy.map((q) => q[1]);
  const ox = (Math.min(...xs) + Math.max(...xs)) / 2 - Wpx / 2;
  const oy = (Math.min(...ys) + Math.max(...ys)) / 2 - Hpx / 2;
  const cv = document.createElement('canvas'); cv.width = Wpx; cv.height = Hpx;
  const g = cv.getContext('2d');
  g.fillStyle = '#E8E8E8'; g.fillRect(0, 0, Wpx, Hpx);
  const n = 2 ** z; const jobs = [];
  for (let tx = Math.floor(ox / 256); tx <= Math.floor((ox + Wpx) / 256); tx++) {
    for (let ty = Math.floor(oy / 256); ty <= Math.floor((oy + Hpx) / 256); ty++) {
      if (ty < 0 || ty >= n) continue;
      jobs.push(new Promise((res) => {
        const im = new Image();
        im.onload = () => { g.drawImage(im, tx * 256 - ox, ty * 256 - oy); res(); };
        im.onerror = () => res();
        im.src = `tiles/osm/${z}/${((tx % n) + n) % n}/${ty}.png`;
      }));
    }
  }
  await Promise.all(jobs);
  const at = (p) => { const q = proj(p.lat, p.lon, z); return [q[0] - ox, q[1] - oy]; };
  // lines from the hub coordinator's home
  const H = located(hb) ? at(hb) : null;
  if (H) {
    g.strokeStyle = colour; g.globalAlpha = 0.75; g.lineWidth = 3;
    ms.filter(located).forEach((m) => { const P = at(m); g.beginPath(); g.moveTo(H[0], H[1]); g.lineTo(P[0], P[1]); g.stroke(); });
    g.globalAlpha = 1;
  }
  // numbered markers; people at the same address share one marker ("3,4")
  const spots = {};
  ms.forEach((m, i) => {
    if (!located(m)) return;
    const P = at(m); const k = Math.round(P[0]) + ',' + Math.round(P[1]);
    (spots[k] = spots[k] || { P, nums: [] }).nums.push(i + 1);
  });
  const label = (P, text, fill, ink, r) => {
    g.font = `bold ${text.length > 5 ? 13 : 15}px Arial, sans-serif`;
    const w = Math.max(r * 2, g.measureText(text).width + 12);
    g.fillStyle = '#FFFFFF'; g.beginPath(); g.roundRect(P[0] - w / 2 - 2, P[1] - r - 2, w + 4, 2 * r + 4, r + 2); g.fill();
    g.fillStyle = fill; g.beginPath(); g.roundRect(P[0] - w / 2, P[1] - r, w, 2 * r, r); g.fill();
    g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, P[0], P[1] + 1);
  };
  // place labels so they don't cover each other (or the H): nudge them clear and draw a short pointer line
  const boxes = [];
  if (H) boxes.push([H[0] - 20, H[1] - 20, H[0] + 20, H[1] + 20]);
  const hit = (b) => boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
  const placed = [];
  Object.values(spots).sort((a, b) => a.P[1] - b.P[1]).forEach((sp) => {
    const text = sp.nums.join(',');
    g.font = `bold ${text.length > 5 ? 13 : 15}px Arial, sans-serif`;
    const w = Math.max(26, g.measureText(text).width + 12) + 4;
    const offsets = [[0, 0], [0, -30], [0, 30], [34, 0], [-34, 0], [30, -30], [-30, -30], [30, 30], [-30, 30], [0, -60], [0, 60]];
    let pos = sp.P;
    for (const [dx, dy] of offsets) {
      const c = [sp.P[0] + dx, sp.P[1] + dy];
      const b = [c[0] - w / 2, c[1] - 15, c[0] + w / 2, c[1] + 15];
      if (!hit(b)) { pos = c; boxes.push(b); break; }
    }
    placed.push({ sp, pos, text });
  });
  placed.forEach(({ sp, pos }) => {
    if (pos !== sp.P) {
      g.strokeStyle = '#1D2330'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(sp.P[0], sp.P[1]); g.lineTo(pos[0], pos[1]); g.stroke();
      g.fillStyle = '#1D2330'; g.beginPath(); g.arc(sp.P[0], sp.P[1], 3.5, 0, 2 * Math.PI); g.fill();
    }
  });
  if (H) label(H, 'H', colour, contrast(colour, '#FFFFFF') >= contrast(colour, '#111111') ? '#FFFFFF' : '#111111', 16);
  placed.forEach(({ pos, text }) => label(pos, text, '#1D2330', '#FFFFFF', 13));
  // scale bar and attribution
  const lat = (pts.reduce((a, p) => a + p.lat, 0)) / pts.length;
  const mPerPx = 156543.03392 * Math.cos(lat * Math.PI / 180) / 2 ** z;
  const nice = [50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 20000].find((m) => m / mPerPx >= 90) || 20000;
  const bar = nice / mPerPx; const mi = nice / 1609.344;
  g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(10, Hpx - 38, bar + 20, 28);
  g.fillStyle = '#111'; g.fillRect(20, Hpx - 18, bar, 4);
  g.font = '13px Arial, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillText(`${nice >= 1000 ? nice / 1000 + ' km' : nice + ' m'} (${mi < 0.95 ? mi.toFixed(2) : mi.toFixed(1)} mi)`, 20, Hpx - 23);
  const attr = '© OpenStreetMap contributors';
  g.font = '12px Arial, sans-serif'; const aw = g.measureText(attr).width + 10;
  g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(Wpx - aw - 6, Hpx - 22, aw, 18);
  g.fillStyle = '#333'; g.fillText(attr, Wpx - aw - 1, Hpx - 9);
  return cv.toDataURL('image/jpeg', 0.9);
}

async function printCallLists(hubIds, includeUnassigned) {
  const withMaps = prefs.printMaps !== false;
  const st = SETTINGS;
  const c = STATE.centre || {};
  const org = st.show_org_name && st.org_name ? st.org_name : '';
  const logo = st.show_org_logo && STATE.images && STATE.images.org_logo;
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const phones = (p) => [p.mobile ? `<div>M: ${esc(p.mobile)}</div>` : '', p.telephone ? `<div>T: ${esc(p.telephone)}</div>` : ''].join('') || '<span class="pc-none">-</span>';
  const statusText = (p) => p.statuses.filter((k) => k !== 'hub_coordinator').map((k) => statusLabel[k]).join(', ');
  const header = (title, sub) => `<header class="pc-head">
      ${logo ? `<img src="${esc(logo)}" alt="">` : ''}
      <div class="pc-titles">${org ? `<div class="pc-org">${esc(org)}</div>` : ''}
        <h1>${title}</h1>${sub ? `<div class="pc-sub">${sub}</div>` : ''}</div>
      <div class="pc-date">Printed ${esc(today)}${STATE.demo ? '<div class="pc-demo">DEMO - made-up people</div>' : ''}</div>
    </header>`;
  const table = (ms) => `<table class="pc-table"><thead><tr>
      <th style="width:4%">#</th><th style="width:21%">Name</th><th style="width:18%">Phone</th><th style="width:25%">Address</th>
      <th style="width:16%">Statuses / notes</th><th style="width:8%">Contacted</th><th style="width:8%">OK?</th></tr></thead><tbody>
      ${ms.map((m, i) => `<tr>
        <td>${i + 1}</td>
        <td><b>${esc(fullName(m))}</b>${isHub(m) ? `<div class="pc-tag">Hub coordinator${levels() > 1 ? ` (level ${m.hub_level || 1})` : ''} - has their own list</div>` : ''}</td>
        <td class="pc-phone">${phones(m)}</td>
        <td>${esc([m.address1, m.address2, m.town, m.postcode].filter(Boolean).join(', '))}</td>
        <td>${esc(statusText(m))}${m.notes ? `<div class="pc-notes">${esc(m.notes)}</div>` : ''}</td>
        <td class="pc-box"></td><td class="pc-box"></td></tr>`).join('')}
    </tbody></table>`;

  let html = '';
  const hubCol = hubColourMap();
  let drawn = 0;
  for (const id of hubIds) {
    const hb = byId[id];
    if (!hb) continue;
    const ms = STATE.contacts.filter((m) => m.hub === id).sort((a, b) => (isHub(b) - isHub(a)) || ((a.hub_km ?? 1e9) - (b.hub_km ?? 1e9)));
    let mapImg = null;
    if (withMaps) {
      busy(true, `Drawing the maps&hellip; ${++drawn} of ${hubIds.length}<br><small>Areas not viewed before are fetched once and then kept</small>`);
      try { mapImg = await renderHubMap(hb, ms, SETTINGS.spoke_color_mode === 'single' ? SETTINGS.spoke_color : (hubCol[hb.id] || '#1A9E77')); } catch (e) { mapImg = null; }
    }
    const notOnMap = ms.filter((m) => !located(m)).length;
    const parent = hb.hub && byId[hb.hub];
    const reportTo = parent
      ? `<b>${esc(fullName(parent))}</b> (hub coordinator) &middot; ${esc([parent.mobile, parent.telephone].filter(Boolean).join(' / ') || 'no phone on file')}`
      : `<b>${esc(c.name || 'the central hub')}</b>${c.postcode_display ? ` (${esc(c.postcode_display)})` : ''}${centreContactLines(c, false).map((l) => '<br>' + l).join('') || '<br>No contact details on file'}`;
    html += `<section class="call-page">
      ${header(`Call list: ${esc(fullName(hb))}`, `${levels() > 1 ? `Level ${hb.hub_level || 1} hub coordinator &middot; ` : 'Hub coordinator &middot; '}${ms.length} ${ms.length === 1 ? 'person' : 'people'} to contact`)}
      <div class="pc-info">
        <div><span>Hub coordinator</span><b>${esc(fullName(hb))}</b> &middot; ${esc([hb.mobile, hb.telephone].filter(Boolean).join(' / ') || 'no phone on file')}<br>${esc([hb.address1, hb.town, hb.postcode].filter(Boolean).join(', '))}</div>
        <div><span>Report back to</span>${reportTo}</div>
      </div>
      ${mapImg ? `<figure class="pc-map"><img src="${mapImg}" alt="Map of this group"><figcaption>Numbers match the list. <b>H</b> = ${esc(fullName(hb))}'s home.
        ${notOnMap ? `${notOnMap} ${notOnMap === 1 ? 'person is' : 'people are'} not on the map (no usable address).` : ''}</figcaption></figure>` : ''}
      ${ms.length ? table(ms) : '<p>Nobody is assigned to this hub yet.</p>'}
      <footer class="pc-foot">Confidential: contains personal information. Keep it safe, do not share it, and shred it when no longer needed. In an emergency where life is at risk, call 999.</footer>
    </section>`;
  }
  busy(false);
  if (includeUnassigned) {
    const orphans = STATE.contacts.filter((p) => !isHub(p) && !p.hub);
    if (orphans.length) {
      html += `<section class="call-page">${header('People not in any hub group', `${orphans.length} ${orphans.length === 1 ? 'person' : 'people'} - not on the map, so they need a hub chosen by hand`)}
        ${table(orphans)}<footer class="pc-foot">Confidential: contains personal information. Keep it safe and shred it when no longer needed.</footer></section>`;
    }
  }
  if (!html) { toast('There are no call lists to print yet', true); return; }
  $('printArea').innerHTML = html;
  const theme = document.documentElement.dataset.theme;
  const fitPages = () => {
    // Shrink each hub's page until it fits on one A4 sheet (277 mm tall inside 10 mm margins).
    // Very large groups stop at a readable minimum and run onto a second sheet.
    const area = $('printArea');
    area.classList.add('measuring');
    const mm = 96 / 25.4;
    const pageH = 272 * mm;            // a little under 277 mm to allow for rounding
    area.querySelectorAll('.call-page').forEach((pg) => {
      if (pg.querySelector('.pc-map')) { pg.style.fontSize = '9pt'; return; }   // with a map, the list simply continues overleaf
      let size = 9;
      pg.style.fontSize = size + 'pt';
      while (pg.scrollHeight > pageH && size > 6) {
        size = Math.round((size - 0.25) * 100) / 100;
        pg.style.fontSize = size + 'pt';
      }
    });
    area.classList.remove('measuring');
  };
  document.documentElement.dataset.theme = 'light';
  document.body.classList.add('print-calls');
  const done = () => {
    document.body.classList.remove('print-calls');
    document.documentElement.dataset.theme = theme;
    $('printArea').innerHTML = '';
    window.removeEventListener('afterprint', done);
    toast('Once the lists are printed and handed out, click "Confirm call lists printed" to record the date.', false, 8000);
  };
  window.addEventListener('afterprint', done);
  // wait for the logo to load before opening the print dialog
  const imgs = [...$('printArea').querySelectorAll('img')];
  Promise.all(imgs.map((im) => (im.complete ? 1 : new Promise((r) => { im.onload = r; im.onerror = r; })))).then(() => { fitPages(); setTimeout(() => window.print(), 50); });
}

function printModal() {
  const theme = document.documentElement.dataset.theme;
  document.documentElement.dataset.theme = 'light';
  document.body.classList.add('printing');
  setTimeout(() => { window.print(); document.body.classList.remove('printing'); document.documentElement.dataset.theme = theme; }, 50);
}

// ------------------------------------------------------------------ table view
// Filters here only affect the table; the map always shows everyone (subject to the legend).
let fromTable = false;
const T = {
  q: '', statuses: new Set(), notOnMap: false,
  pc: '', radius: '0.5', unit: 'mi', centre: null,   // centre = {lat, lon, label} once a postcode is looked up
  sort: { key: 'name', dir: 1 },
  keep: new Set(),      // rows edited since the filters last changed stay visible
  scroll: 0,
};
const SHORT = { leader: 'Leader', small_group_leader: 'SG leader', vulnerable: 'Vulnerable', single: 'Single occ.', hub_coordinator: 'Hub coord.' };

function tableRows() {
  const q = T.q.trim().toLowerCase();
  const rKm = T.centre ? (parseFloat(T.radius) || 0) * (T.unit === 'mi' ? 1.609344 : 1) : null;
  const rows = [];
  STATE.contacts.forEach((p) => {
    const dist = T.centre && located(p) ? haversine(T.centre, p) : null;
    const keep = T.keep.has(p.id);
    if (!keep) {
      if (q && !fullName(p).toLowerCase().includes(q) && !`${p.last_name} ${p.first_name}`.toLowerCase().includes(q)) return;
      if (T.statuses.size) {
        const hit = [...T.statuses].some((k) => (k === 'none' ? p.statuses.length === 0 : p.statuses.includes(k)));
        if (!hit) return;
      }
      if (T.notOnMap && located(p)) return;
      if (T.centre && (dist == null || dist > rKm)) return;
    }
    rows.push({ p, dist });
  });
  const k = T.sort.key; const dir = T.sort.dir;
  const val = (r) => {
    const p = r.p;
    if (k === 'name') return `${p.last_name} ${p.first_name}`.toLowerCase();
    if (k === 'postcode') return p.postcode.replace(/\s+/g, '').toUpperCase() || '~';
    if (k === 'town') return (p.town || '~').toLowerCase();
    if (k === 'hub') return p.hub && byId[p.hub] ? fullName(byId[p.hub]).toLowerCase() : (isHub(p) ? ' ' : '~');
    if (k === 'dist') return r.dist == null ? 1e9 : r.dist;
    if (k.startsWith('st:')) return p.statuses.includes(k.slice(3)) ? 0 : 1;
    return '';
  };
  rows.sort((a, b) => { const va = val(a); const vb = val(b); return (va < vb ? -1 : va > vb ? 1 : 0) * dir; });
  return rows;
}

function showTable() {
  const chipsHtml = statusKeys.concat(['none']).map((k) => `<button type="button" class="fchip ${T.statuses.has(k) ? 'on' : ''}" data-f="${k}">
      <span class="swatch" style="background:${COLORS[k]}"></span>${esc(statusLabel[k])}</button>`).join('') +
    `<button type="button" class="fchip ${T.notOnMap ? 'on' : ''}" data-f="__nomap"><span class="swatch" style="background:#fff;box-shadow:0 0 0 1px var(--danger)"></span>Not on map</button>`;
  const h = `<div class="tv-tools">
      <div class="tv-row">
        <label class="tv-field grow"><span>Name</span><input type="search" id="tvQ" placeholder="Search by name" value="${esc(T.q)}"></label>
        <label class="tv-field"><span>Near postcode</span><input type="search" id="tvPc" placeholder="e.g. SP8 4GR" value="${esc(T.pc)}" style="width:130px"></label>
        <label class="tv-field"><span>Within</span><span class="inline"><input type="number" id="tvRadius" min="0.05" step="0.1" value="${esc(T.radius)}" style="width:80px">
          <select id="tvUnit" style="width:auto"><option value="mi" ${T.unit === 'mi' ? 'selected' : ''}>miles</option><option value="km" ${T.unit === 'km' ? 'selected' : ''}>km</option></select></span></label>
        <div class="tv-field"><span>&nbsp;</span><span class="inline"><button class="btn small primary" id="tvPcGo">Search area</button>
          <button class="btn small" id="tvPcClear" ${T.centre ? '' : 'hidden'}>Clear area</button></span></div>
      </div>
      <div class="tv-row tv-chips"><span class="muted" style="font-size:12px">Show people with any of:</span>${chipsHtml}
        <button class="link" id="tvChipsClear" style="font-size:12px" ${T.statuses.size || T.notOnMap ? '' : 'hidden'}>show everyone</button></div>
      <div class="tv-summary" id="tvSummary"></div>
    </div>
    <div class="tv-scroll" id="tvScroll"><table class="data tv-table" id="tvTable"></table></div>`;
  openModal('Table view', h, '<span class="muted" style="font-size:12px;align-self:center">Tick boxes save straight away</span>', 'wide tableview');
  renderTable();
  $('tvScroll').scrollTop = T.scroll;
  $('tvScroll').addEventListener('scroll', () => { T.scroll = $('tvScroll').scrollTop; });

  const refilter = () => { T.keep.clear(); T.scroll = 0; renderTable(); $('tvScroll').scrollTop = 0; };
  $('tvQ').addEventListener('input', () => { T.q = $('tvQ').value; refilter(); });
  $('modalBody').querySelectorAll('.fchip').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.f;
    if (k === '__nomap') T.notOnMap = !T.notOnMap;
    else if (T.statuses.has(k)) T.statuses.delete(k); else T.statuses.add(k);
    b.classList.toggle('on');
    $('tvChipsClear').hidden = !(T.statuses.size || T.notOnMap);
    refilter();
  }));
  $('tvChipsClear').addEventListener('click', () => { T.statuses.clear(); T.notOnMap = false; showTable(); });
  const goArea = async () => {
    T.pc = $('tvPc').value.trim(); T.radius = $('tvRadius').value; T.unit = $('tvUnit').value;
    if (!T.pc) { toast('Type a postcode to search around', true); return; }
    if (!(parseFloat(T.radius) > 0)) { toast('Enter a distance, e.g. 0.5', true); return; }
    try {
      const r = await api(`/api/lookup?postcode=${encodeURIComponent(T.pc)}`);
      T.pc = r.postcode;
      T.centre = { lat: r.lat, lon: r.lon, label: r.postcode };
      if (T.sort.key === 'name') T.sort = { key: 'dist', dir: 1 };
      T.keep.clear(); T.scroll = 0;
      showTable();
    } catch (e) { toast(e.message, true); }
  };
  $('tvPcGo').addEventListener('click', goArea);
  $('tvPc').addEventListener('keydown', (e) => { if (e.key === 'Enter') goArea(); });
  $('tvRadius').addEventListener('keydown', (e) => { if (e.key === 'Enter') goArea(); });
  $('tvRadius').addEventListener('change', () => { if (T.centre) goArea(); });
  $('tvUnit').addEventListener('change', () => { if (T.centre) goArea(); });
  $('tvPcClear').addEventListener('click', () => {
    T.centre = null; T.pc = ''; if (T.sort.key === 'dist') T.sort = { key: 'name', dir: 1 };
    T.keep.clear(); showTable();
  });
}

function renderTable() {
  const rows = tableRows();
  const area = T.centre;
  const sortMark = (k) => (T.sort.key === k ? (T.sort.dir > 0 ? ' &#9650;' : ' &#9660;') : '');
  const th = (k, label, cls = '') => `<th class="sortable ${cls}" data-sort="${k}">${label}${sortMark(k)}</th>`;
  const counts = Object.fromEntries(statusKeys.map((k) => [k, rows.filter((r) => r.p.statuses.includes(k)).length]));
  let html = `<thead><tr>${th('name', 'Name')}${th('town', 'Address')}${th('postcode', 'Postcode')}<th>Phone</th>
    ${statusKeys.map((k) => `<th class="st-col sortable" data-sort="st:${k}" title="${esc(statusLabel[k])}">
      <span class="swatch" style="background:${COLORS[k]}"></span><br>${esc(statusLabel[k])}${sortMark('st:' + k)}<div class="st-count">${counts[k]}</div></th>`).join('')}
    ${th('hub', 'Hub coordinator')}${area ? th('dist', 'Distance') : ''}</tr></thead><tbody>`;
  if (!rows.length) html += `<tr><td colspan="${statusKeys.length + 6}" class="muted" style="padding:20px;text-align:center">Nobody matches these filters.</td></tr>`;
  rows.forEach(({ p, dist }) => {
    const hub = isHub(p) ? (levels() > 1
      ? `<select class="lvl-select" data-level="${p.id}" title="Hub level">${Array.from({ length: levels() }, (_, i) => `<option value="${i + 1}" ${(p.hub_level || 1) === i + 1 ? 'selected' : ''}>Level ${i + 1} hub</option>`).join('')}</select>${p.hub && byId[p.hub] ? ` <span class="muted">in ${esc(fullName(byId[p.hub]))}&rsquo;s group</span>` : ''}`
      : '<span class="muted">is a hub</span>') : p.hub && byId[p.hub]
      ? `${esc(fullName(byId[p.hub]))}${p.hub_auto ? '' : ' <small class="muted">(chosen)</small>'}` : '<span class="muted">-</span>';
    html += `<tr data-id="${p.id}" class="${T.keep.has(p.id) ? 'kept' : ''}">
      <td class="tv-name"><button class="link" data-open-row="${p.id}">${esc(p.last_name)}, ${esc(p.first_name)}</button>
        ${located(p) ? '' : '<span class="nomap" title="Not on the map">not on map</span>'}${p.notes ? ' <span class="muted" title="Has notes">&#9998;</span>' : ''}</td>
      <td>${esc([p.address1, p.town].filter(Boolean).join(', '))}</td>
      <td class="nowrap">${esc(p.postcode)}</td>
      <td class="nowrap">${esc(p.mobile || p.telephone || '')}</td>
      ${statusKeys.map((k) => `<td class="st-col"><input type="checkbox" data-st="${k}" ${p.statuses.includes(k) ? 'checked' : ''}
        style="accent-color:${COLORS[k]}" aria-label="${esc(statusLabel[k])}"></td>`).join('')}
      <td>${hub}</td>${area ? `<td class="nowrap">${dist == null ? '' : miles(dist)}</td>` : ''}</tr>`;
  });
  html += '</tbody>';
  $('tvTable').innerHTML = html;

  const total = STATE.contacts.length;
  const radiusText = area ? ` within ${esc(T.radius)} ${T.unit === 'mi' ? (parseFloat(T.radius) === 1 ? 'mile' : 'miles') : 'km'} of <b>${esc(area.label)}</b>` : '';
  $('tvSummary').innerHTML = `Showing <b>${rows.length}</b> of ${total} people${radiusText}.` +
    (T.keep.size ? ' <span class="muted">Rows you just changed stay listed (highlighted) until you change the filters.</span>' : '') +
    ' <span class="muted">The map is not affected.</span>';

  const table = $('tvTable');
  table.querySelectorAll('th.sortable').forEach((el) => el.addEventListener('click', () => {
    const k = el.dataset.sort;
    T.sort = T.sort.key === k ? { key: k, dir: -T.sort.dir } : { key: k, dir: 1 };
    renderTable();
  }));
  table.querySelectorAll('[data-open-row]').forEach((el) => el.addEventListener('click', () => {
    fromTable = true;
    focusPerson(el.dataset.openRow);
  }));
  table.querySelectorAll('input[data-st]').forEach((cb) => cb.addEventListener('change', () => tableSetStatus(cb)));
  table.querySelectorAll('select[data-level]').forEach((sel) => sel.addEventListener('change', () => tableSave(sel.dataset.level, { hub_level: +sel.value })));
}

async function tableSave(id, body) {
  try {
    const s = await api(`/api/contacts/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    T.keep.add(id);
    applyState(s);
    const sc = $('tvScroll').scrollTop;
    renderTable();
    $('tvScroll').scrollTop = sc;
  } catch (e) { toast(e.message, true); }
}

async function tableSetStatus(cb) {
  const tr = cb.closest('tr');
  const id = tr.dataset.id;
  const statuses = [...tr.querySelectorAll('input[data-st]')].filter((x) => x.checked).map((x) => x.dataset.st);
  tr.querySelectorAll('input[data-st]').forEach((x) => { x.disabled = true; });
  try {
    const s = await api(`/api/contacts/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ statuses }) });
    T.keep.add(id);
    applyState(s);              // map, legend and any open card update underneath
    const sc = $('tvScroll').scrollTop;
    renderTable();
    $('tvScroll').scrollTop = sc;
    const row = $('tvTable').querySelector(`tr[data-id="${id}"]`);
    if (row) { row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 900); }
  } catch (e) {
    toast(e.message, true);
    cb.checked = !cb.checked;
    tr.querySelectorAll('input[data-st]').forEach((x) => { x.disabled = false; });
  }
}

// ------------------------------------------------------------------ settings
function currentSettingsDraft() {
  const c = STATE.centre || {};
  return {
    centre: { name: c.name || '', postcode: c.postcode_display || '', lat: c.lat, lon: c.lon,
      landline: c.landline || '', mobile: c.mobile || '', email: c.email || '', other: c.other || '' },
    settings: JSON.parse(JSON.stringify(STATE.settings)),
  };
}

function showSettings(draft) {
  if (!STATE || !STATE.settings) { toast(RESTART_MSG, true); return; }
  settingsDraft = draft || currentSettingsDraft();
  const d = settingsDraft;
  const st = d.settings;
  const colourRow = (k, label) => `<label class="set-colour"><input type="color" data-colour="${k}" value="${esc(st.status_colors[k])}">
    <span>${esc(label)}</span></label>`;
  const num = (id, val, min, max, step, unit) => `<span class="set-num"><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}">
    <output id="${id}Out">${val}${unit}</output></span>`;
  const imgs = STATE.images || {};
  const imgBox = (kind, url, label) => `<div class="img-pick">
      <div class="img-preview">${url ? `<img src="${esc(url)}" alt="">` : '<span class="muted">No image</span>'}</div>
      <div class="img-btns"><button type="button" class="btn small" data-img-choose="${kind}">${url ? 'Change' : 'Choose'} ${label}&hellip;</button>
        ${url ? `<button type="button" class="btn small danger" data-img-remove="${kind}">Remove</button>` : ''}
        <input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" data-img-file="${kind}" hidden></div></div>`;
  const demoChip = STATE.demo ? ' <span class="chip grey">Not available in the demo</span>' : '';
  const demoOff = (label) => (STATE.demo ? `<section class="demo-off" inert aria-label="${label} - not available in the demo">` : '<section>');
  const tabs = [['org', 'Organisation details'], ['status', 'Statuses'], ['data', 'Data & privacy'], ['look', 'Look and feel'], ['about', 'About & updates']];
  if (!tabs.some((t) => t[0] === settingsTab)) settingsTab = 'org';
  const h = `<div class="set-tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" class="set-tab-btn${settingsTab === k ? ' active' : ''}" data-tab="${k}" aria-selected="${settingsTab === k}">${l}</button>`).join('')}</div>
  <form class="settings" id="settingsForm" autocomplete="off">
  <div class="set-panel" data-panel="org" ${settingsTab === 'org' ? '' : 'hidden'}>
    <section>
      <h3>Organisation</h3>
      <p class="muted">Shown in the title bar. Untick to hide it without losing it.</p>
      <div class="form-grid">
        <label>Organisation name<input type="text" id="setOrgName" value="${esc(st.org_name)}" maxlength="100" placeholder="e.g. St Mary's Community Church"></label>
        <label class="check-inline"><input type="checkbox" id="setShowOrgName" ${st.show_org_name ? 'checked' : ''}> Show the name in the title bar</label>
      </div>
      <div class="form-grid" style="margin-top:12px">
        <div class="set-field"><span>Logo</span>${imgBox('org_logo', imgs.org_logo, 'logo')}</div>
        <label class="check-inline"><input type="checkbox" id="setShowOrgLogo" ${st.show_org_logo ? 'checked' : ''}> Show the logo in the title bar</label>
      </div>
      <p class="muted" style="margin-top:8px;font-size:12px">Images save as soon as you choose them. PNG, JPG, GIF, WebP or SVG, up to 3 MB. A square image works best.</p>
    </section>
    <section>
      <h3>Central hub</h3>
      <p class="muted">The place every hub coordinator links back to, shown on the map as a circle.</p>
      <div class="form-grid">
        <label>Name<input type="text" id="setName" value="${esc(d.centre.name)}" maxlength="80" required></label>
        <label>Postcode<span class="inline"><input type="text" id="setPostcode" value="${esc(d.centre.postcode)}">
          <button type="button" class="btn small" id="btnFindPc">Find</button></span></label>
        <label>Latitude<input type="number" step="any" id="setLat" value="${d.centre.lat ?? ''}"></label>
        <label>Longitude<input type="number" step="any" id="setLon" value="${d.centre.lon ?? ''}"></label>
      </div>
      <div class="row-btns"><button type="button" class="btn small" id="btnPickCentre">Pick the position on the map</button>
        <span class="muted" style="align-self:center;font-size:12px">Use this if the postcode position isn't quite right.</span></div>
      <div class="lg-head" style="margin-top:14px">Contact details</div>
      <p class="muted" style="font-size:12px;margin:2px 0 8px">Level 1 hub coordinators report back here. Shown on their cards, their printed call lists and the map.</p>
      <div class="form-grid">
        <label>Landline<input type="tel" id="setCLandline" value="${esc(d.centre.landline || '')}" maxlength="40"></label>
        <label>Mobile<input type="tel" id="setCMobile" value="${esc(d.centre.mobile || '')}" maxlength="40"></label>
        <label>Email<input type="email" id="setCEmail" value="${esc(d.centre.email || '')}" maxlength="120"></label>
      </div>
      <label class="set-field" style="margin-top:10px">Other (free text)<textarea id="setCOther" maxlength="1000" placeholder="e.g. Out of hours: ring the minister on 07700 900123. Radio channel 3. Key holder: J. Smith.">${esc(d.centre.other || '')}</textarea></label>
    </section>
    <section>
      <h3>Hub levels</h3>
      <p class="muted">With more than one grouping level, a hub coordinator's group can include other hub coordinators, who each have a group of their own.
        For example: Pete (level 1) has Sue in his group; Sue (level 2) has Dave in hers. Dave is only on Sue's list, not Pete's.</p>
      <div class="form-grid">
        <label>Grouping levels<select id="setLevels">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${st.grouping_levels === n ? 'selected' : ''}>${n}${n === 1 ? ' (single layer of hubs)' : ' levels'}</option>`).join('')}</select></label>
      </div>
      <p class="muted" style="margin-top:8px;font-size:12px">Set each hub coordinator's level on their card or in Table view. New hub coordinators start at level 1.
        A level 2 hub joins the nearest level 1 hub automatically, unless you choose one. Everyone else joins their nearest hub coordinator of any level.</p>
    </section>
  </div>
  <div class="set-panel" data-panel="status" ${settingsTab === 'status' ? '' : 'hidden'}>
    <section>
      <h3>Statuses</h3>
      <p class="muted">The labels you can tick on each person. Rename, recolour, add or remove them to suit your organisation.
        The order sets priority: a dot takes the colour of the person's highest status in this list.</p>
      <ol class="status-editor">${st.statuses.map((x, i) => {
        const n = STATE.contacts.filter((c) => c.statuses.includes(x.key)).length;
        const hub = x.key === 'hub_coordinator';
        return `<li data-skey="${esc(x.key)}">
          <span class="prio">${i + 1}</span>
          <input type="color" data-colour="${esc(x.key)}" value="${esc(st.status_colors[x.key] || '#8C8C8C')}" title="Colour">
          <input type="text" data-slabel="${esc(x.key)}" value="${esc(x.label)}" maxlength="40" aria-label="Status name">
          <span class="muted s-count">${n} ${n === 1 ? 'person' : 'people'}${hub ? ' &middot; drives the hub network' : ''}</span>
          <span class="s-btns">
            <button type="button" class="btn small" data-smove="-1" title="Higher priority" ${i === 0 ? 'disabled' : ''}>&#9650;</button>
            <button type="button" class="btn small" data-smove="1" title="Lower priority" ${i === st.statuses.length - 1 ? 'disabled' : ''}>&#9660;</button>
            <button type="button" class="btn small danger" data-sdel title="${hub ? 'Needed for the hub network - it can be renamed but not removed' : 'Remove this status'}" ${hub ? 'disabled' : ''}>&#10005;</button>
          </span></li>`;
      }).join('')}</ol>
      <div class="row-btns">
        <button type="button" class="btn small" id="btnAddStatus" ${st.statuses.length >= 15 ? 'disabled' : ''}>+ Add a status</button>
      </div>
      <label class="set-colour" style="margin-top:14px"><input type="color" data-colour="none" value="${esc(st.status_colors.none || '#8C8C8C')}"><span>People with no status</span></label>
      <p class="muted" style="margin-top:10px;font-size:12px">Ideas: First aider, Has a car, Carer, Key holder, Speaks Welsh. Changes apply when you press Save.
        Removing a status takes it off everyone who has it.</p>
    </section>
  </div>
  <div class="set-panel" data-panel="data" ${settingsTab === 'data' ? '' : 'hidden'}>
    <section class="demo-sec">
      <h3>Demo mode ${STATE.demo ? '<span class="chip" style="background:var(--warn)">On</span>' : '<span class="chip grey">Off</span>'}</h3>
      <p class="muted">The demo shows a made-up church, so you can show the system to others without revealing anyone's details.
        Every name, address, postcode and phone number in it is invented. Your real data is kept separately and is not touched while the demo is on${(STATE.security || {}).encrypted ? '; it stays locked until you turn the demo off and enter the passphrase' : ''}.
        Anything you change in the demo stays in the demo.</p>
      <label class="switch-line"><input type="checkbox" id="setDemo" ${STATE.demo ? 'checked' : ''}><span>Demo on</span></label>
      ${STATE.demo ? '<div class="row-btns"><button type="button" class="btn small" id="btnDemoReset">Reset demo data</button> <span class="muted" style="font-size:12px">Puts the made-up people, hubs and settings back as they started.</span></div>' : ''}
    </section>
    ${demoOff('ChurchSuite')}
      <h3>ChurchSuite${demoChip}</h3>
      <p class="muted">Fetch the contact list straight from ChurchSuite instead of uploading a CSV. Only people with the tags below are fetched,
        and the link is read-only: nothing is ever changed in ChurchSuite. CSV upload keeps working as well.</p>
      <div class="form-grid">
        <label>Client ID<input type="text" id="csClientId" value="${esc((STATE.churchsuite || {}).client_id || '')}" autocomplete="off" spellcheck="false"></label>
        <label>Client Secret<input type="password" id="csSecret" autocomplete="new-password"
          placeholder="${(STATE.churchsuite || {}).has_secret ? 'Saved - leave blank to keep it' : 'Paste the secret here'}"></label>
      </div>
      <div class="row-btns">
        <button type="button" class="btn small primary" id="btnCsSave">${(STATE.churchsuite || {}).catalog && STATE.churchsuite.catalog.length ? 'Save &amp; refresh tag list' : 'Connect to ChurchSuite'}</button>
        ${(STATE.churchsuite || {}).configured ? '<button type="button" class="btn small danger" id="btnCsRemove">Disconnect</button>' : ''}
      </div>
      <div id="csResult"></div>
      <div id="csTagPicker"></div>
      <p class="muted" style="margin-top:8px;font-size:12px">In ChurchSuite, an Administrator enables API access for a dedicated user with view-only Address Book permission,
        then generates the Client ID and Secret for that user. The secret is stored only on this PC, in the data folder.
        ${(STATE.churchsuite || {}).last_sync ? `Last sync: ${esc(fmtDate(STATE.churchsuite.last_sync))}.` : ''}</p>
    </section>
    ${demoOff('CSV upload')}
      <h3>CSV upload${demoChip}</h3>
      <p class="muted">Without a connection, use <b>Upload contacts CSV</b> in the title bar. The file must be a complete export with the columns
        First Name, Last Name, Address 1, Address 2, Town/City, County, Postcode, Country, Telephone, Mobile, Email.</p>
    </section>
    ${demoOff('Encryption')}
      <h3>Encryption${demoChip} ${(STATE.security || {}).encrypted ? '<span class="chip" style="background:var(--ok)">On</span>' : '<span class="chip grey">Off</span>'}</h3>
      ${(STATE.security || {}).encrypted ? `
      <p class="muted">The data folder is encrypted. The app asks for the passphrase when it starts, after the lock button (&#128274;) is pressed,
        and after it has not been used for the auto-lock time.</p>
      <div class="form-grid">
        <label>Lock automatically after<select id="setAutoLock">${[[0, 'Never'], [10, '10 minutes'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [240, '4 hours']]
          .map(([v, l]) => `<option value="${v}" ${(st.auto_lock_minutes ?? 30) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <details class="sec-more"><summary>Change the passphrase</summary>
        <div class="form-grid">
          <label>Current passphrase<input type="password" id="secOld" autocomplete="current-password"></label>
          <label>New passphrase<input type="password" id="secNew" autocomplete="new-password"></label>
          <label>New passphrase again<input type="password" id="secNew2" autocomplete="new-password"></label>
        </div>
        <div class="row-btns"><button type="button" class="btn small primary" id="btnSecChange">Change passphrase</button></div>
      </details>
      <details class="sec-more"><summary>Turn encryption off</summary>
        <p class="muted" style="font-size:12px">The data files will be stored unencrypted again.</p>
        <div class="form-grid"><label>Passphrase<input type="password" id="secOff" autocomplete="current-password"></label></div>
        <div class="row-btns"><button type="button" class="btn small danger" id="btnSecOff">Turn encryption off</button></div>
      </details>` : `
      <p class="muted">Encrypt the contact data, backups and ChurchSuite details on this PC with a passphrase, so they can't be read if the PC
        or its drive is lost or stolen. The app then needs the passphrase each time it starts. Logos and the app's settings file are not encrypted.</p>
      <div class="form-grid">
        <label>Passphrase<input type="password" id="secNew" autocomplete="new-password" placeholder="At least 12 characters"></label>
        <label>Passphrase again<input type="password" id="secNew2" autocomplete="new-password"></label>
      </div>
      <p class="muted" style="font-size:12px;margin:6px 0">Tip: three or four random words (e.g. <i>teapot river lantern seven</i>) are strong and easy to remember.</p>
      <label class="check-inline ack-line"><input type="checkbox" id="secAck"><span>I understand that if the passphrase is lost, the data <b>cannot be recovered</b>.
        I will keep it somewhere safe, such as a password manager or a sealed envelope held by our data protection lead.</span></label>
      <div class="row-btns"><button type="button" class="btn small primary" id="btnSecOn">Turn encryption on</button></div>`}
      <div id="secMsg"></div>
    </section>
    <section>
      <h3>Data protection</h3>
      <p class="muted">Your organisation is the data controller for this list. The Data Protection Pack is a PDF in your branding that explains your
        responsibilities under UK law, with a privacy notice paragraph, a risk assessment (DPIA) outline, a hub coordinator confidentiality agreement and checklists.</p>
      <div class="form-grid">
        <label>Data protection lead (name)<input type="text" id="setDpName" value="${esc(st.dp_lead_name || '')}" maxlength="100" placeholder="e.g. Church Administrator"></label>
        <label>Their contact details<input type="text" id="setDpContact" value="${esc(st.dp_lead_contact || '')}" maxlength="200" placeholder="e.g. office@... or 01747 ..."></label>
      </div>
      <div class="row-btns"><button type="button" class="btn small primary" id="btnDpPack">&#128196; Create Data Protection Pack (PDF)</button></div>
      <p class="muted" style="font-size:12px">The pack uses your organisation name, logo, accent colour, central hub details and statuses. Save your settings first if you have just changed them.
        It is general guidance, not legal advice.</p>
    </section>
  </div>
  <div class="set-panel" data-panel="look" ${settingsTab === 'look' ? '' : 'hidden'}>
    <section>
      <h3>Appearance</h3>
      <div class="accent-row">
        <label class="set-colour"><input type="color" id="setAccentPick" value="${esc(st.accent_color)}"><span>Accent colour</span></label>
        <input type="text" id="setAccent" value="${esc(st.accent_color)}" maxlength="7" spellcheck="false" style="width:100px" aria-label="Accent colour hex code">
        <button type="button" class="link" id="btnAccentReset">Use the default</button>
      </div>
      <p class="muted" style="font-size:12px;margin:4px 0 12px">Your organisation's colour, used for the title bar, window headings and the sidebar cards.
        Text on it switches between light and dark automatically so it stays readable. Paste a hex code (e.g. #6A1B9A) to match your branding exactly.</p>
      <div class="theme-grid">
        <div class="lg-head">Interface</div>
        <div class="set-radio">
          <label><input type="radio" name="theme" value="light" ${st.theme !== 'dark' ? 'checked' : ''}> &#9728; Light</label>
          <label><input type="radio" name="theme" value="dark" ${st.theme === 'dark' ? 'checked' : ''}> &#9790; Dark</label>
        </div>
        <div class="lg-head">Map</div>
        <div class="set-radio">
          <label><input type="radio" name="mapTheme" value="auto" ${!['light', 'dark'].includes(st.map_theme) ? 'checked' : ''}> Same as the interface</label>
          <label><input type="radio" name="mapTheme" value="light" ${st.map_theme === 'light' ? 'checked' : ''}> &#9728; Always light</label>
          <label><input type="radio" name="mapTheme" value="dark" ${st.map_theme === 'dark' ? 'checked' : ''}> &#9790; Always dark</label>
        </div>
      </div>
      <p class="muted" style="margin-top:6px;font-size:12px">The moon/sun button in the title bar switches the interface; the map follows it only when set to &ldquo;Same as the interface&rdquo;. Printouts are always light.</p>
      <div class="lg-head" style="margin-top:12px">Map for use without internet</div>
      <p class="muted" style="font-size:12px;margin:2px 0 6px">Every part of the <b>street map</b> you view is kept on this PC and used first, so areas you have already looked at
        (at the zoom levels you looked at them) still show if the internet goes down. To prepare, browse your area and zoom in on the streets you may need.
        Stored squares are refreshed when they are over a week old. The satellite view always needs the internet. Up to 500 MB is kept; the least recently used is removed first.</p>
      <div class="row-btns"><span class="muted" id="tileCacheInfo" style="align-self:center;font-size:13px">Checking&hellip;</span>
        <button type="button" class="btn small" id="btnTileClear">Clear stored map</button></div>
    </section>
    <section>
      <h3>Central hub marker</h3>
      <p class="muted">How the central hub appears on the map.</p>
      <div class="centre-opts">
        <div class="centre-big" id="centreBig"></div>
        <div class="centre-fields">
          <label class="set-colour"><input type="color" id="setCentreColour" value="${esc(st.centre_color)}"><span>Circle colour</span></label>
          <div class="set-radio" style="flex-direction:column;gap:8px">
            <label><input type="radio" name="centreSym" value="star" ${st.centre_symbol === 'star' ? 'checked' : ''}> Star
              <input type="color" id="setStarColour" value="${esc(st.centre_star_color)}" title="Star colour"></label>
            <label><input type="radio" name="centreSym" value="org_logo" ${st.centre_symbol === 'org_logo' ? 'checked' : ''} ${imgs.org_logo ? '' : 'disabled'}>
              Organisation logo ${imgs.org_logo ? '' : '<span class="muted" style="font-size:12px">(add a logo under Organisation details first)</span>'}</label>
            <label><input type="radio" name="centreSym" value="image" ${st.centre_symbol === 'image' ? 'checked' : ''} ${imgs.centre_image ? '' : 'disabled'}>
              Another image ${imgs.centre_image ? '' : '<span class="muted" style="font-size:12px">(choose one below)</span>'}</label>
          </div>
          <div style="margin-top:4px">${imgBox('centre_image', imgs.centre_image, 'image')}</div>
          <label class="set-line" style="margin-top:8px">Marker size ${num('setCentreSize', st.centre_size, 20, 80, 1, ' px')}</label>
        </div>
      </div>
    </section>
    <section>
      <h3>Dots</h3>
      <p class="muted">Dot colours are set on the Statuses tab.</p>
      <label class="set-line">Dot size ${num('setDot', st.dot_size, 8, 32, 1, ' px')}</label>
    </section>
    <section>
      <h3>Lines</h3>
      <div class="line-grid">
        <div class="lg-head">Central hub &rarr; hub coordinator</div>
        <label>Colour <input type="color" id="setCentreCol" value="${esc(st.centre_line_color)}"></label>
        <label>Width ${num('setCentreW', st.centre_line_width, 0.5, 12, 0.5, ' px')}</label>
        <div class="lg-head">Hub coordinator &rarr; hub coordinator in their group <span class="muted" style="font-weight:400">(when there is more than one grouping level)</span></div>
        <label>Width ${num('setSubW', st.subhub_line_width, 0.5, 12, 0.5, ' px')}</label>
        <div class="lg-head">Hub coordinator &rarr; person</div>
        <label>Width ${num('setSpokeW', st.spoke_width, 0.5, 12, 0.1, ' px')}</label>
        <label>Width when hub chosen by hand (dashed) ${num('setManualW', st.spoke_manual_width, 0.5, 12, 0.1, ' px')}</label>
        <label>Opacity ${num('setOpacity', st.spoke_opacity, 0.1, 1, 0.05, '')}</label>
        <div class="set-radio">
          <label><input type="radio" name="spokeMode" value="per_hub" ${st.spoke_color_mode !== 'single' ? 'checked' : ''}> A different colour for each hub</label>
          <label><input type="radio" name="spokeMode" value="single" ${st.spoke_color_mode === 'single' ? 'checked' : ''}> One colour for all
            <input type="color" id="setSpokeCol" value="${esc(st.spoke_color)}"></label>
        </div>
        <div id="paletteWrap" ${st.spoke_color_mode === 'single' ? 'hidden' : ''}>
          <div class="muted" style="font-size:12px;margin-bottom:6px">Hub colours, used in turn (hubs in alphabetical order):</div>
          <div class="palette">${st.hub_palette.map((c, i) => `<input type="color" data-pal="${i}" value="${esc(c)}" title="Hub ${i + 1}">`).join('')}</div>
        </div>
      </div>
      <svg class="line-preview" id="linePreview" viewBox="0 0 320 70" aria-label="Preview of the lines"></svg>
    </section>
  </div>
  <div class="set-panel" data-panel="about" ${settingsTab === 'about' ? '' : 'hidden'}>
    ${aboutPanelHtml()}
  </div>
  </form>`;
  openModal('Settings', h, '<button class="btn small" id="btnResetSettings" title="Puts the colours, lines and marker back to how they started. Your organisation details, statuses and hub levels are not changed.">Reset look and feel</button> <button class="btn small primary" id="btnSaveSettings">Save</button>', 'settingsmodal');

  const form = $('settingsForm');
  $('modalBody').querySelectorAll('.set-tab-btn').forEach((b) => b.addEventListener('click', () => {
    settingsTab = b.dataset.tab;
    $('modalBody').querySelectorAll('.set-tab-btn').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-selected', x === b); });
    $('modalBody').querySelectorAll('.set-panel').forEach((pn) => { pn.hidden = pn.dataset.panel !== settingsTab; });
    $('modalBody').scrollTop = 0;
  }));
  $('setDemo').addEventListener('change', async (e) => {
    try {
      await api('/api/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: e.target.checked }) });
    } catch (err) { if (err.message !== 'Locked') { toast(err.message, true); e.target.checked = !e.target.checked; return; } }
    location.reload();
  });
  if ($('btnDemoReset')) $('btnDemoReset').addEventListener('click', async () => {
    try {
      await api('/api/demo/reset', { method: 'POST' });
      location.reload();
    } catch (err) { toast(err.message, true); }
  });
  const sync = () => { readSettingsForm(); drawLinePreview(); previewAccent(); };
  const pick = $('setAccentPick'); const hex = $('setAccent');
  pick.addEventListener('input', () => { hex.value = pick.value.toUpperCase(); });
  hex.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(hex.value.trim())) pick.value = hex.value.trim(); });
  $('btnAccentReset').addEventListener('click', () => { hex.value = STATE.default_settings.accent_color; pick.value = hex.value; sync(); });
  const secPost = async (url, body, okMsg) => {
    $('secMsg').innerHTML = '<div class="alert info">Working - re-saving the data files&hellip;</div>';
    try {
      STATE.security = await api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      readSettingsForm(); applyState(STATE); showSettings(settingsDraft);
      $('secMsg').innerHTML = `<div class="alert info">${okMsg}</div>`;
    } catch (e) { $('secMsg').innerHTML = `<div class="alert bad">${esc(e.message)}</div>`; }
  };
  if ($('btnSecOn')) $('btnSecOn').addEventListener('click', () => {
    const a = $('secNew').value; const b = $('secNew2').value;
    if (a.length < 12) { $('secMsg').innerHTML = '<div class="alert bad">Use at least 12 characters.</div>'; return; }
    if (a !== b) { $('secMsg').innerHTML = '<div class="alert bad">The two passphrases are different.</div>'; return; }
    if (!$('secAck').checked) { $('secMsg').innerHTML = '<div class="alert bad">Please tick to confirm you understand the passphrase cannot be recovered.</div>'; return; }
    secPost('/api/security/enable', { passphrase: a }, 'Encryption is on. Keep the passphrase safe.');
  });
  if ($('btnSecChange')) $('btnSecChange').addEventListener('click', () => {
    if ($('secNew').value !== $('secNew2').value) { $('secMsg').innerHTML = '<div class="alert bad">The two new passphrases are different.</div>'; return; }
    secPost('/api/security/change', { old: $('secOld').value, new: $('secNew').value }, 'Passphrase changed.');
  });
  if ($('btnSecOff')) $('btnSecOff').addEventListener('click', () => {
    if (!confirm('Turn encryption off? The data files will be stored unencrypted on this PC.')) return;
    secPost('/api/security/disable', { passphrase: $('secOff').value }, 'Encryption is off.');
  });
  bindAboutPanel();
  $('btnDpPack').addEventListener('click', async () => {
    readSettingsForm();
    const b = $('btnDpPack'); b.disabled = true; b.textContent = 'Creating the pack...';
    try { await buildDataProtectionPack(STATE, settingsDraft); toast('Data Protection Pack downloaded'); } catch (e) { toast('Could not create the pack: ' + e.message, true); }
    b.disabled = false; b.innerHTML = '&#128196; Create Data Protection Pack (PDF)';
  });
  const showTileInfo = (t) => { const mb = (t.bytes / 1048576); $('tileCacheInfo').textContent = `Stored: ${t.count} squares, ${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`; };
  api('/api/tilecache').then(showTileInfo).catch(() => { $('tileCacheInfo').textContent = ''; });
  $('btnTileClear').addEventListener('click', async () => {
    if (!confirm('Clear the stored street map? Areas will need the internet again until you view them.')) return;
    try { showTileInfo(await api('/api/tilecache/clear', { method: 'POST' })); toast('Stored map cleared'); } catch (e) { toast(e.message, true); }
  });
  const editStatuses = (fn) => { readSettingsForm(); fn(settingsDraft.settings.statuses); showSettings(settingsDraft); };
  $('modalBody').querySelectorAll('[data-smove]').forEach((b) => b.addEventListener('click', () => {
    const key = b.closest('li').dataset.skey; const dir = +b.dataset.smove;
    editStatuses((list) => { const i = list.findIndex((x) => x.key === key); const j = i + dir; if (j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]]; });
  }));
  $('modalBody').querySelectorAll('[data-sdel]').forEach((b) => b.addEventListener('click', () => {
    const key = b.closest('li').dataset.skey;
    const n = STATE.contacts.filter((c) => c.statuses.includes(key)).length;
    const label = (settingsDraft.settings.statuses.find((x) => x.key === key) || {}).label || 'this status';
    if (n && !confirm(`Remove "${label}"? ${n} ${n === 1 ? 'person has' : 'people have'} it - it will be taken off them when you press Save.`)) return;
    editStatuses((list) => { const i = list.findIndex((x) => x.key === key); if (i >= 0) list.splice(i, 1); });
  }));
  if ($('btnAddStatus')) $('btnAddStatus').addEventListener('click', () => {
    const spare = ['#E67E22', '#16A085', '#8E44AD', '#C0392B', '#2980B9', '#D4AC0D', '#7F8C8D', '#27AE60', '#E84393', '#34495E'];
    const used = new Set(Object.values(settingsDraft.settings.status_colors).map((c) => c.toUpperCase()));
    const key = 's_' + Math.random().toString(36).slice(2, 10);
    editStatuses((list) => { list.push({ key, label: 'New status' }); });
    settingsDraft.settings.status_colors[key] = spare.find((c) => !used.has(c)) || '#7F8C8D';
    showSettings(settingsDraft);
    const inp = document.querySelector(`[data-slabel="${key}"]`);
    if (inp) { inp.focus(); inp.select(); }
  });
  form.addEventListener('input', (e) => {
    if (e.target.type === 'range') {
      const o = $(e.target.id + 'Out');
      if (o) o.textContent = e.target.value + (e.target.id === 'setOpacity' ? '' : ' px');
    }
    sync();
  });
  form.addEventListener('change', () => { sync(); $('paletteWrap').hidden = settingsDraft.settings.spoke_color_mode === 'single'; });
  form.addEventListener('submit', (e) => { e.preventDefault(); saveSettings(); });
  form.querySelectorAll('[data-img-choose]').forEach((b) => b.addEventListener('click', () => form.querySelector(`[data-img-file="${b.dataset.imgChoose}"]`).click()));
  form.querySelectorAll('[data-img-file]').forEach((inp) => inp.addEventListener('change', async () => {
    const f = inp.files[0];
    if (!f) return;
    const kind = inp.dataset.imgFile;
    readSettingsForm();
    try {
      const s = await api(`/api/image/${kind}`, { method: 'POST', headers: { 'Content-Type': f.type || 'application/octet-stream' }, body: await f.arrayBuffer() });
      STATE.images = s.images;
      if (kind === 'centre_image') settingsDraft.settings.centre_symbol = 'image';
      applyBranding(); renderMap();
      showSettings(settingsDraft);
      toast('Image saved');
    } catch (e) { toast(e.message, true); }
  }));
  form.querySelectorAll('[data-img-remove]').forEach((b) => b.addEventListener('click', async () => {
    const kind = b.dataset.imgRemove;
    readSettingsForm();
    try {
      const s = await api(`/api/image/${kind}?remove=1`, { method: 'POST' });
      STATE.images = s.images;
      const sym = settingsDraft.settings.centre_symbol;
      if ((kind === 'org_logo' && sym === 'org_logo') || (kind === 'centre_image' && sym === 'image')) settingsDraft.settings.centre_symbol = 'star';
      applyBranding(); renderMap();
      showSettings(settingsDraft);
      toast('Image removed');
    } catch (e) { toast(e.message, true); }
  }));
  $('btnFindPc').addEventListener('click', async () => {
    const pc = $('setPostcode').value.trim();
    if (!pc) { toast('Type a postcode first', true); return; }
    try {
      const r = await api(`/api/lookup?postcode=${encodeURIComponent(pc)}`);
      $('setPostcode').value = r.postcode; $('setLat').value = r.lat; $('setLon').value = r.lon;
      readSettingsForm();
      toast(`Found ${r.postcode}`);
    } catch (e) { toast(e.message, true); }
  });
  $('btnPickCentre').addEventListener('click', () => {
    readSettingsForm();
    const keep = settingsDraft;
    closeModal();
    settingsDraft = keep;
    previewAccent();
    if (settingsDraft.centre.lat != null && settingsDraft.centre.lat !== '') map.setView([settingsDraft.centre.lat, settingsDraft.centre.lon], Math.max(map.getZoom(), 16));
    startPlacing(CENTRE_PICK);
  });
  $('btnResetSettings').addEventListener('click', () => {
    readSettingsForm();
    // only the Look and feel settings - organisation details, statuses and hub levels are left alone
    const LOOK = ['accent_color', 'theme', 'map_theme', 'dot_size', 'centre_line_color', 'centre_line_width', 'spoke_width', 'spoke_manual_width',
      'spoke_opacity', 'spoke_color_mode', 'spoke_color', 'hub_palette', 'subhub_line_width', 'centre_color', 'centre_symbol',
      'centre_star_color', 'centre_size'];
    LOOK.forEach((k) => { settingsDraft.settings[k] = JSON.parse(JSON.stringify(STATE.default_settings[k])); });
    settingsTab = 'look';
    showSettings(settingsDraft);
    previewAccent();
    toast('Look and feel defaults loaded - press Save to keep them');
  });
  $('btnSaveSettings').addEventListener('click', saveSettings);
  $('btnCsSave').addEventListener('click', csSaveAndTest);
  renderTagPicker();
  if ($('btnCsRemove')) $('btnCsRemove').addEventListener('click', async () => {
    if (!confirm('Disconnect ChurchSuite? The saved Client ID and Secret are deleted from this PC. Your contacts stay as they are.')) return;
    try {
      STATE.churchsuite = await api('/api/churchsuite/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ remove: true }) });
      readSettingsForm(); applyState(STATE); showSettings(settingsDraft); toast('ChurchSuite disconnected');
    } catch (e) { toast(e.message, true); }
  });
  drawLinePreview();
}

// ------------------------------------------------------------------ ChurchSuite
async function csSaveAndTest() {
  const out = $('csResult');
  const body = { client_id: $('csClientId').value.trim() };
  if ($('csSecret').value.trim()) body.client_secret = $('csSecret').value.trim();
  out.innerHTML = '<div class="alert info">Connecting to ChurchSuite and fetching your tags&hellip;</div>';
  try {
    STATE.churchsuite = await api('/api/churchsuite/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    $('csSecret').value = '';
    $('csSecret').placeholder = STATE.churchsuite.has_secret ? 'Saved - leave blank to keep it' : 'Paste the secret here';
    await csCheck();
    $('btnCsSave').textContent = 'Save & refresh tag list';
  } catch (e) {
    out.innerHTML = `<div class="alert bad">${esc(e.message)}</div>`;
  }
}

// Ask ChurchSuite for the latest tag list and how many people the chosen tags cover
async function csCheck() {
  const out = $('csResult');
  try {
    const r = await api('/api/churchsuite/test', { method: 'POST' });
    STATE.churchsuite = r.churchsuite;
    applyState(STATE);
    renderTagPicker();
    renderCsSummary(r);
  } catch (e) {
    out.innerHTML = `<div class="alert bad">${esc(e.message)}</div>`;
  }
}

function renderCsSummary(r) {
  const out = $('csResult');
  if (!out) return;
  const rows = r.chosen.map((t) => `<li><b>${esc(t.name)}</b>: ${t.count ?? '?'} active ${t.count === 1 ? 'person' : 'people'}${t.is_smart ? ' <span class="muted">(smart tag)</span>' : ''}</li>`).join('');
  let h = `<div class="alert info"><b>Connected to ChurchSuite</b> &middot; ${STATE.churchsuite.catalog.length} tags found.`;
  if (r.chosen.length) {
    h += `<ul class="cs-list">${rows}</ul>${r.total != null ? `<b>${r.total}</b> people in total will be fetched (anyone with more than one of these tags is counted once).` : ''}`;
  } else {
    h += '<br>Tick the tags to include below.';
  }
  h += '</div>';
  if (r.renamed && r.renamed.length) h += `<div class="alert info">Renamed in ChurchSuite: ${r.renamed.map(esc).join('; ')}. They are still ticked.</div>`;
  if (r.gone && r.gone.length) h += `<div class="alert bad">No longer in ChurchSuite: <b>${r.gone.map(esc).join(', ')}</b>. Untick it and choose again below.</div>`;
  if (r.chosen.length && !(r.gone && r.gone.length)) h += '<div class="row-btns"><button type="button" class="btn small primary" id="btnCsSyncNow">Sync now</button></div>';
  out.innerHTML = h;
  if ($('btnCsSyncNow')) $('btnCsSyncNow').addEventListener('click', () => { closeModal(); syncChurchSuite(); });
}

function renderTagPicker() {
  const box = $('csTagPicker');
  if (!box) return;
  const cs = STATE.churchsuite || {};
  const cat = cs.catalog || [];
  if (!cat.length) { box.innerHTML = ''; return; }
  const chosen = new Set(cs.tag_ids || []);
  const groups = {};
  cat.forEach((t) => { (groups[t.category || 'Other tags'] = groups[t.category || 'Other tags'] || []).push(t); });
  const sw = (t) => (/^#[0-9a-f]{3,8}$/i.test(t.colour || '') ? `<span class="swatch" style="background:${esc(t.colour)}"></span>` : '');
  box.innerHTML = `<div class="cs-picker-head">
      <div><b>Tags to include</b> <span class="muted">- anyone with any ticked tag is included</span>
        <div class="muted" style="font-size:12px">${chosen.size} chosen${chosen.size ? ': ' + cat.filter((t) => chosen.has(t.id)).map((t) => esc(t.name)).join(', ') : ''}.
          Tag list from ChurchSuite${cs.catalog_updated ? `, updated ${esc(fmtDate(cs.catalog_updated))}` : ''} and on every sync.</div></div>
      ${cat.length > 10 ? '<input type="search" id="csTagFilter" placeholder="Filter tags" style="max-width:220px">' : ''}
    </div>
    <div class="cs-picker">${Object.keys(groups).map((g) => `<div class="cs-cat"><div class="cs-cat-name">${esc(g)}</div>
      ${groups[g].map((t) => `<label class="cs-tag" data-name="${esc(t.name.toLowerCase())}"><input type="checkbox" data-tag-id="${t.id}" ${chosen.has(t.id) ? 'checked' : ''}>
        ${sw(t)}<span>${esc(t.name)}</span>${t.is_smart ? '<small class="muted">smart</small>' : ''}</label>`).join('')}</div>`).join('')}</div>`;
  let timer = null;
  box.querySelectorAll('[data-tag-id]').forEach((cb) => cb.addEventListener('change', () => {
    clearTimeout(timer);
    $('csResult').innerHTML = '<div class="alert info">Saving your choice and counting people&hellip;</div>';
    timer = setTimeout(async () => {
      const ids = [...box.querySelectorAll('[data-tag-id]:checked')].map((x) => +x.dataset.tagId);
      try {
        STATE.churchsuite = await api('/api/churchsuite/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag_ids: ids }) });
        await csCheck();
      } catch (e) { toast(e.message, true); }
    }, 700);
  }));
  if ($('csTagFilter')) $('csTagFilter').addEventListener('input', () => {
    const q = $('csTagFilter').value.trim().toLowerCase();
    box.querySelectorAll('.cs-tag').forEach((l) => { l.hidden = !!q && !l.dataset.name.includes(q); });
    box.querySelectorAll('.cs-cat').forEach((c) => { c.hidden = ![...c.querySelectorAll('.cs-tag')].some((l) => !l.hidden); });
  });
}

async function syncChurchSuite(confirmed = false) {
  busy(true, 'Fetching the contact list from ChurchSuite&hellip;<br><small>New or changed addresses may take a little longer</small>');
  try {
    const r = await fetch('/api/churchsuite/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: confirmed }) });
    let data = null;
    try { data = await r.json(); } catch (e) { /* ignore */ }
    if (r.status === 404) throw new Error(RESTART_MSG);
    if (r.status === 423) { busy(false); showLockScreen(); return; }
    if (r.status === 409 && data && data.needs_confirm) {
      busy(false);
      const ok = confirm(`This sync would remove ${data.removing} people from the emergency list (keeping ${data.keeping}${data.adding ? ` and adding ${data.adding}` : ''}).\n\n` +
        'That is a lot - it can happen if the tags in Settings are wrong. A backup is made either way.\n\nContinue with the sync?');
      if (ok) return syncChurchSuite(true);
      toast('Sync cancelled - nothing was changed');
      return;
    }
    if (!r.ok) throw new Error((data && data.error) || `Sync failed (${r.status})`);
    await loadState();
    busy(false);
    showReports(data.id);
  } catch (e) {
    busy(false);
    toast(e.message, true);
  }
}

function readSettingsForm() {
  const d = settingsDraft;
  const st = d.settings;
  const lat = $('setLat').value.trim(); const lon = $('setLon').value.trim();
  d.centre = { name: $('setName').value.trim(), postcode: $('setPostcode').value.trim(), lat: lat === '' ? null : +lat, lon: lon === '' ? null : +lon,
    landline: $('setCLandline').value.trim(), mobile: $('setCMobile').value.trim(), email: $('setCEmail').value.trim(), other: $('setCOther').value.trim() };
  document.querySelectorAll('[data-colour]').forEach((i) => { st.status_colors[i.dataset.colour] = i.value; });
  st.statuses = [...document.querySelectorAll('.status-editor li')].map((li) => ({
    key: li.dataset.skey, label: li.querySelector('[data-slabel]').value.trim() }));
  st.accent_color = $('setAccent').value;
  if ($('setAutoLock')) st.auto_lock_minutes = +$('setAutoLock').value;
  st.dp_lead_name = $('setDpName').value.trim();
  st.dp_lead_contact = $('setDpContact').value.trim();
  st.dot_size = +$('setDot').value;
  st.centre_line_color = $('setCentreCol').value;
  st.centre_line_width = +$('setCentreW').value;
  st.spoke_width = +$('setSpokeW').value;
  st.spoke_manual_width = +$('setManualW').value;
  st.spoke_opacity = +$('setOpacity').value;
  st.spoke_color_mode = (document.querySelector('input[name=spokeMode]:checked') || {}).value || 'per_hub';
  st.spoke_color = $('setSpokeCol').value;
  st.hub_palette = [...document.querySelectorAll('[data-pal]')].map((i) => i.value);
  st.org_name = $('setOrgName').value.trim();
  st.show_org_name = $('setShowOrgName').checked;
  st.show_org_logo = $('setShowOrgLogo').checked;
  st.theme = (document.querySelector('input[name=theme]:checked') || {}).value || 'light';
  st.map_theme = (document.querySelector('input[name=mapTheme]:checked') || {}).value || 'auto';
  st.centre_color = $('setCentreColour').value;
  st.centre_star_color = $('setStarColour').value;
  st.centre_symbol = (document.querySelector('input[name=centreSym]:checked') || {}).value || 'star';
  st.centre_size = +$('setCentreSize').value;
  st.grouping_levels = +$('setLevels').value;
  st.subhub_line_width = +$('setSubW').value;
}

function drawLinePreview() {
  const st = settingsDraft.settings;
  const sc = (i) => st.spoke_color_mode === 'single' ? st.spoke_color : st.hub_palette[i % st.hub_palette.length];
  const dot = (x, y, col, hub) => hub
    ? `<circle cx="${x}" cy="${y}" r="${(st.dot_size + 4) / 2}" fill="${col}" stroke="#fff" stroke-width="3"/><circle cx="${x}" cy="${y}" r="${(st.dot_size + 4) / 2 + 2.5}" fill="none" stroke="#1d2330" stroke-width="2"/>`
    : `<circle cx="${x}" cy="${y}" r="${st.dot_size / 2}" fill="${col}" stroke="#fff" stroke-width="2"/>`;
  const people = [[250, 14, 'vulnerable'], [285, 38, 'single'], [250, 60, 'none']];
  let svg = `<line x1="28" y1="36" x2="150" y2="36" stroke="${st.centre_line_color}" stroke-width="${st.centre_line_width}" opacity=".85"/>`;
  people.forEach(([x, y], i) => {
    svg += `<line x1="150" y1="36" x2="${x}" y2="${y}" stroke="${sc(0)}" stroke-width="${i === 2 ? st.spoke_manual_width : st.spoke_width}" opacity="${st.spoke_opacity}" ${i === 2 ? 'stroke-dasharray="5 4"' : ''}/>`;
  });
  const cimg = centreImage(st);
  svg += `<clipPath id="cpClip"><circle cx="28" cy="36" r="11"/></clipPath><circle cx="28" cy="36" r="14" fill="${esc(st.centre_color)}" stroke="#fff" stroke-width="3"/>` +
    (cimg ? `<image href="${esc(cimg)}" x="17" y="25" width="22" height="22" preserveAspectRatio="xMidYMid meet" clip-path="url(#cpClip)"/>`
      : `<text x="28" y="42" text-anchor="middle" fill="${esc(st.centre_star_color)}" font-size="17">&#9733;</text>`);
  svg += dot(150, 36, st.status_colors.hub_coordinator, true);
  people.forEach(([x, y, k]) => { svg += dot(x, y, st.status_colors[k], false); });
  $('linePreview').innerHTML = svg;
  if ($('centreBig')) $('centreBig').innerHTML = centrePinHtml(st);
}

async function saveSettings() {
  readSettingsForm();
  const d = settingsDraft;
  if (!/^#[0-9a-f]{6}$/i.test(d.settings.accent_color || '')) { settingsTab = 'look'; showSettings(d); toast('The accent colour must be a hex code like #23395D', true); return; }
  if (!d.centre.name) { settingsTab = 'org'; showSettings(d); toast('The central hub needs a name', true); return; }
  if (d.settings.statuses.some((x) => !x.label)) { settingsTab = 'status'; showSettings(d); toast('Every status needs a name', true); return; }
  try {
    const s = await api('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
    applyState(s);
    settingsDraft = null;
    closeModal();
    toast('Settings saved');
  } catch (e) { toast(e.message, true); }
}

// ------------------------------------------------------------------ upload
async function uploadFile(file) {
  if (STATE && STATE.contacts.length) {
    const ok = confirm(`Upload "${file.name}" as the complete, current contact list?\n\n` +
      'Anyone not in this file will be removed. Statuses, hub choices and notes are kept for everyone who is still in it. ' +
      'A backup of the current data is saved first.');
    if (!ok) return;
  }
  busy(true, 'Uploading and looking up postcodes...<br><small>New or changed addresses can take a little while</small>');
  try {
    const buf = await file.arrayBuffer();
    const report = await api(`/api/upload?filename=${encodeURIComponent(file.name)}`, { method: 'POST', body: buf, headers: { 'Content-Type': 'text/csv' } });
    await loadState();
    busy(false);
    showReports(report.id);
  } catch (e) {
    busy(false);
    toast(e.message, true);
  }
}

// ------------------------------------------------------------------ misc UI
function busy(on, text) {
  $('busy').hidden = !on;
  if (text) $('busyText').innerHTML = text;
}
let toastTimer = null;
// ------------------------------------------------------------------ versions and updates
const PAGE_VERSION = (document.querySelector('meta[name="ehc-version"]') || {}).content || '';
function verTuple(v) { const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '')); return m ? m.slice(1).map(Number) : null; }
function verCmp(a, b) { const x = verTuple(a); const y = verTuple(b); if (!x || !y) return 0; for (let i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; } return 0; }

// The page and the server should be the same version. A newer server (after an update) means this page is old: reload it.
// A newer page means the files were replaced but the server wasn't restarted.
function checkPageVersion(serverVersion) {
  if (!serverVersion || !PAGE_VERSION || serverVersion === PAGE_VERSION) return;
  if (verCmp(serverVersion, PAGE_VERSION) > 0) {
    let done = null;
    try { done = sessionStorage.getItem('ehc.reloadedFor'); sessionStorage.setItem('ehc.reloadedFor', serverVersion); } catch (e) { /* ignore */ }
    if (done !== serverVersion) location.reload();
  } else {
    setTimeout(() => toast(RESTART_MSG, true), 300);
  }
}

function showUpdateNotice(u) {
  const on = !!(u && u.available && u.latest);
  $('btnSettings').classList.toggle('has-update', on);
  $('btnSettings').title = on ? `Settings - version ${u.latest.version} is available` : 'Settings';
  if (!on) return;
  let shown = null;
  try { shown = sessionStorage.getItem('ehc.updateToast'); sessionStorage.setItem('ehc.updateToast', u.latest.version); } catch (e) { /* ignore */ }
  if (shown !== u.latest.version) setTimeout(() => toast(`Version ${u.latest.version} is available. Settings \u2192 About & updates has the details.`, false, 8000), 1500);
}

// release notes come as simple Markdown: headings, bullet points and paragraphs
function notesHtml(md) {
  const out = []; let list = false;
  const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');
  String(md || '').replace(/\r/g, '').split('\n').forEach((line) => {
    const li = /^\s*[-*] +(.*)$/.exec(line);
    if (li) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(li[1])}</li>`); return; }
    if (list) { out.push('</ul>'); list = false; }
    const h = /^#{1,6} +(.*)$/.exec(line);
    if (h) out.push(`<p class="notes-h">${inline(h[1])}</p>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  });
  if (list) out.push('</ul>');
  return out.join('');
}

function aboutPanelHtml() {
  const u = STATE.update || {};
  return `<section>
      <h3>Emergency Hub Coordinator</h3>
      <p>You're using version <b>${esc(STATE.app_version || '?')}</b>. It's free and open source under the MIT licence.
        ${u.repo ? `New versions are published on <a href="https://github.com/${esc(u.repo)}/releases" target="_blank" rel="noopener">GitHub</a>.` : ''}</p>
    </section>
    <section>
      <h3>Updates</h3>
      <div id="updBox">${updateBoxHtml(u)}</div>
      <label class="check-inline" style="margin-top:10px"><input type="checkbox" id="updAuto" ${u.auto_check !== false ? 'checked' : ''}>
        <span>Check for new versions once a day</span></label>
      <p class="muted" style="font-size:12px;margin-top:8px">Checking asks GitHub, where new versions are published, whether there's a newer one.
        GitHub sees this computer's internet address, but nothing about your contacts. An update only replaces the program's own files:
        your data, settings and passphrase are left exactly as they are, and the version you had is kept so you can go back to it.</p>
    </section>`;
}

function updateBoxHtml(u) {
  const checked = u.last_check ? `Last checked ${esc(fmtDate(u.last_check))}.` : 'Not checked yet.';
  let h = '';
  if (u.restart_pending) {
    h += `<div class="alert info">The new version is installed. ${u.mode === 'auto' ? 'The app is restarting&hellip;'
      : 'To finish, close the black server window and open <b>Emergency Hub</b> again, then refresh this page.'}</div>`;
  } else if (u.available && u.latest) {
    const pub = u.latest.published ? ` &middot; released ${esc(fmtDate(u.latest.published))}` : '';
    h += `<div class="update-card">
        <div class="update-title">Version ${esc(u.latest.version)} is available<span class="muted">${pub}</span></div>
        ${u.latest.notes ? `<div class="update-notes">${notesHtml(u.latest.notes)}</div>` : ''}
        ${u.mode === 'off' ? '<p class="muted">This copy runs in Docker, so update it by pulling the new image rather than from here.</p>'
          : `<div class="row-btns"><button type="button" class="btn small primary" id="btnUpdInstall">Install version ${esc(u.latest.version)}</button>
            ${u.latest.page ? `<a class="btn small" href="${esc(u.latest.page)}" target="_blank" rel="noopener">See it on GitHub</a>` : ''}</div>
            <p class="muted" style="font-size:12px;margin:6px 0 0">Takes under a minute. ${u.mode === 'auto' ? 'The app restarts by itself and this page reloads.'
              : 'Afterwards you\'ll need to close the black server window and start the app again.'}</p>`}
      </div>`;
  } else if (u.error) {
    h += `<div class="alert warn">Couldn't check for updates: ${esc(u.error)}</div>`;
  } else if (u.last_check) {
    h += `<div class="update-ok">&#10003; You're up to date.</div>`;
  }
  h += `<div class="row-btns" style="margin-top:8px"><button type="button" class="btn small" id="btnUpdCheck">Check now</button>
      <span class="muted" style="align-self:center;font-size:12px">${checked}</span></div>`;
  if (u.previous && u.mode !== 'off' && !u.restart_pending) {
    h += `<p class="muted" style="font-size:12px;margin-top:10px">Version ${esc(u.previous)} is kept in case you need it.
      <button type="button" class="link" id="btnUpdBack">Go back to version ${esc(u.previous)}</button></p>`;
  }
  return h;
}

function bindAboutPanel() {
  const box = $('updBox');
  if (!box) return;
  const refresh = (u) => { STATE.update = u; box.innerHTML = updateBoxHtml(u); bindAboutPanel(); showUpdateNotice(u); };
  $('updAuto').onchange = async (e) => {
    try { refresh(await api('/api/update/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auto_check: e.target.checked }) })); } catch (err) { toast(err.message, true); }
  };
  $('btnUpdCheck').onclick = async () => {
    $('btnUpdCheck').disabled = true; $('btnUpdCheck').textContent = 'Checking...';
    try { refresh(await api('/api/update/check', { method: 'POST' })); } catch (err) { toast(err.message, true); refresh(STATE.update || {}); }
  };
  if ($('btnUpdInstall')) $('btnUpdInstall').onclick = () => runUpdate('/api/update/install', STATE.update.latest.version, refresh);
  if ($('btnUpdBack')) $('btnUpdBack').onclick = () => runUpdate('/api/update/rollback', STATE.update.previous, refresh);
}

async function runUpdate(url, version, refresh) {
  const back = url.endsWith('rollback');
  busy(true, back ? `Going back to version ${esc(version)}&hellip;` : `Downloading and installing version ${esc(version)}&hellip;`);
  let r;
  try {
    r = await api(url, { method: 'POST' });
  } catch (err) {
    busy(false); toast(err.message, true); return;
  }
  if (r.mode !== 'auto') { busy(false); refresh(r); return; }
  // wait for the server to come back as the new version, then reload the page
  busy(true, `Restarting as version ${esc(version)}&hellip;<br><small>This page will reload by itself.</small>`);
  const until = Date.now() + 90000;
  const poll = async () => {
    try {
      const v = await (await fetch('/api/version', { cache: 'no-store' })).json();
      if (v.version === version) { location.reload(); return; }
    } catch (e) { /* still restarting */ }
    if (Date.now() < until) setTimeout(poll, 1500);
    else { busy(false); toast('The app hasn\'t come back yet. If the black server window has closed, double-click Emergency Hub to start it again.', true); }
  };
  setTimeout(poll, 2500);
}

function toast(msg, isError = false, ms = 0) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms || (isError ? 10000 : 2500));
}

function setAllFilters(v) {
  statusKeys.concat(['none']).forEach((k) => { filters[k] = v; });
  savePref('ehc.filters', filters);
  renderAll(false);
}

$('btnUpload').addEventListener('click', () => $('fileInput').click());
$('btnSync').addEventListener('click', () => syncChurchSuite());
$('btnUpload2').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) uploadFile(f); });
$('btnReport').addEventListener('click', () => showReports());
$('btnUnmapped').addEventListener('click', showUnmapped);
$('btnHubs').addEventListener('click', showHubGroups);
$('btnTable').addEventListener('click', () => showTable());
$('btnSettings').addEventListener('click', () => showSettings());
$('btnTheme').addEventListener('click', toggleTheme);
try { applyTheme(localStorage.getItem('ehc.theme') || 'light'); } catch (e) { /* ignore */ }
$('drawerClose').addEventListener('click', closeCard);
$('modalClose').addEventListener('click', closeModal);
$('modalBack').addEventListener('click', (e) => { if (e.target === $('modalBack')) closeModal(); });
$('placingCancel').addEventListener('click', () => { const wasCentre = placingId === CENTRE_PICK; stopPlacing(); if (wasCentre) showSettings(settingsDraft); });
$('legendAll').addEventListener('click', () => setAllFilters(true));
$('legendNone').addEventListener('click', () => setAllFilters(false));
$('search').addEventListener('input', runSearch);
$('toggleNetwork').checked = prefs.network;
$('toggleCluster').checked = prefs.cluster;
$('btnSidePrint').addEventListener('click', printAllCallLists);
$('btnSideConfirm').addEventListener('click', confirmPrinted);
$('toggleNetwork').addEventListener('change', (e) => { prefs.network = e.target.checked; savePref('ehc.prefs', prefs); renderMap(); });
$('toggleCluster').addEventListener('change', (e) => { prefs.cluster = e.target.checked; savePref('ehc.prefs', prefs); spiderIds = null; renderMap(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (placingId) stopPlacing(); else if (!$('modalBack').hidden) closeModal(); else closeCard();
});
// drag & drop a CSV anywhere
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) uploadFile(f);
});

// ------------------------------------------------------------------ lock screen and auto-lock
let lockShown = false;
async function showLockScreen() {
  if (lockShown) return;
  if (STATE) { location.reload(); return; }        // clear everything from the page first
  lockShown = true;
  closeModal(); closeCard();
  let sec = {};
  try { sec = await (await fetch('/api/security')).json(); } catch (e) { /* ignore */ }
  const b = sec.branding || {};
  if (b.accent_color) SETTINGS.accent_color = b.accent_color;
  applyTheme(b.theme === 'dark' ? 'dark' : 'light');      // also applies the accent colour
  if (b.logo) { $('lockLogo').src = '/api/lockscreen-logo?' + Date.now(); $('lockLogo').hidden = false; }
  $('lockOrg').textContent = b.org_name || '';
  $('lockScreen').hidden = false;
  setTimeout(() => $('lockPass').focus(), 50);
}
$('lockForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('lockErr').hidden = true;
  $('lockBtn').disabled = true;
  $('lockBtn').textContent = 'Unlocking...';
  try {
    const r = await fetch('/api/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passphrase: $('lockPass').value }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Could not unlock');
    $('lockPass').value = '';
    $('lockScreen').hidden = true;
    lockShown = false;
    firstLoad = true;
    await loadState();
  } catch (err) {
    $('lockErr').textContent = err.message;
    $('lockErr').hidden = false;
    $('lockPass').select();
  } finally {
    $('lockBtn').disabled = false;
    $('lockBtn').textContent = 'Unlock';
  }
});
$('lockDemo').addEventListener('click', async () => {
  try { await fetch('/api/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: true }) }); } catch (e) { /* ignore */ }
  location.reload();
});
$('demoBadge').addEventListener('click', () => { settingsTab = 'data'; showSettings(); });
$('btnLock').addEventListener('click', async () => {
  try { await fetch('/api/lock', { method: 'POST' }); } catch (e) { /* ignore */ }
  location.reload();
});
// Tell the server the app is in use (at most once a minute), and lock after the auto-lock time with no activity
let lastTouch = 0; let lastActivity = Date.now();
['mousemove', 'keydown', 'wheel', 'touchstart', 'click'].forEach((ev) => document.addEventListener(ev, () => {
  lastActivity = Date.now();
  if (STATE && !STATE.demo && STATE.security && STATE.security.encrypted && Date.now() - lastTouch > 60000) {
    lastTouch = Date.now();
    fetch('/api/touch', { method: 'POST' }).then((r) => { if (r.status === 423) showLockScreen(); }).catch(() => {});
  }
}, { passive: true }));
setInterval(() => {
  const mins = STATE && !STATE.demo && STATE.security && STATE.security.encrypted ? (STATE.settings.auto_lock_minutes || 0) : 0;
  if (mins && Date.now() - lastActivity > mins * 60000) {
    fetch('/api/lock', { method: 'POST' }).finally(() => location.reload());
  }
}, 20000);

loadState().catch((e) => { if (e.message !== 'Locked') toast('Could not load data: ' + e.message, true); });
