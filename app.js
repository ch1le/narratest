/* App.js: Simple nearest-POI routing HUD */

/* ---------- Helpers ---------- */
const $ = sel => document.querySelector(sel);
const norm = d => (d % 360 + 360) % 360;
const toRad = d => d * Math.PI / 180;

/* ---------- DOM Refs ---------- */
const enableBtn      = $('#enable');
const permissionBox  = $('#permissionBox');
const permissionText = $('#permissionText');
const selectorRow    = $('#selectorRow');
const descBar        = $('#descBox');
const mapContainer   = $('#map');

/* ---------- Constants ---------- */
const COLORS = {
  primary: '#000',
  all:     '#888',
  compass: '#0066ff'
};

/* ---------- State ---------- */
let DATA;
let map;
let userLat, userLon;
let compassMarker;
let routeControl;
let currentTarget = null;
let currentMarker = null;
let allMarkers = [];
let revealingAll = false;

/* ---------- Initialization ---------- */
Promise.all([
  fetch('content.json').then(r => r.json()),
  new Promise(res => {
    // mock location
    userLat = 58.377679;
    userLon = 26.717398;
    res();
  })
]).then(([json]) => {
  DATA = json;
  permissionText.textContent = json.permissionMessage.replace(/\n/g, '\n');
});

enableBtn.addEventListener('click', startPresent);
function startPresent() {
  // show map
  mapContainer.style.width = '100%';
  mapContainer.style.height = '50vh';

  permissionBox.remove();
  buildMap();
  map.invalidateSize();
  addCompass();
  setupReveal();
  setupRandomize();

  // initial pick
  pickAndRender();
  map.on('zoomend', updateContentBar);
}

/* ---------- Map & Compass ---------- */
function buildMap() {
  map = L.map('map', { zoomControl:false, attributionControl:false })
    .setView([userLat, userLon], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
}
function addCompass() {
  const html = `<div class='compass-icon'><svg width='28' height='28'>` +
               `<polygon points='14,3 18,19 14,15 10,19' fill='${COLORS.compass}'/></svg></div>`;
  compassMarker = L.marker([userLat, userLon], {
    icon: L.divIcon({ html, className:'', iconSize:[28,28], iconAnchor:[14,14] })
  }).addTo(map);
}

/* ---------- Reveal/Hide All ---------- */
function setupReveal() {
  allMarkers = DATA.targets.map(t =>
    L.circleMarker([t.lat, t.lon], { radius:6, color:COLORS.all, weight:1, fillOpacity:1 })
  );
  const btn = document.createElement('button');
  btn.textContent = 'Reveal';
  Object.assign(btn.style, {
    position:'fixed', bottom:'16px', left:'16px', padding:'8px',
    background:'red', color:'#fff', border:'none', borderRadius:'4px', zIndex:30, cursor:'pointer'
  });
  document.body.appendChild(btn);
  btn.addEventListener('click', () => {
    revealingAll = !revealingAll;
    allMarkers.forEach(m => revealingAll ? m.addTo(map) : m.remove());
    btn.textContent = revealingAll ? 'Hide' : 'Reveal';
  });
}

/* ---------- Randomize Location ---------- */
function setupRandomize() {
  const btn = document.createElement('button');
  btn.textContent = 'Randomize';
  Object.assign(btn.style, {
    position:'fixed', bottom:'16px', right:'16px', padding:'8px',
    background:'red', color:'#fff', border:'none', borderRadius:'4px', zIndex:30, cursor:'pointer'
  });
  document.body.appendChild(btn);
  btn.addEventListener('click', () => {
    const R = 6371e3, d = Math.random()*1000, brng = Math.random()*2*Math.PI;
    const lat1 = toRad(58.377679), lon1 = toRad(26.717398);
    const lat2 = Math.asin(Math.sin(lat1)*Math.cos(d/R) + Math.cos(lat1)*Math.sin(d/R)*Math.cos(brng));
    const lon2 = lon1 + Math.atan2(
      Math.sin(brng)*Math.sin(d/R)*Math.cos(lat1),
      Math.cos(d/R)-Math.sin(lat1)*Math.sin(lat2)
    );
    userLat = lat2*180/Math.PI;
    userLon = lon2*180/Math.PI;
    compassMarker.setLatLng([userLat, userLon]);
    map.setView([userLat, userLon], 14);
    pickAndRender();
  });
}

/* ---------- Pick & Render Closest ---------- */
function pickAndRender() {
  // clear old route
  if (routeControl) routeControl.setWaypoints([]);
  // remove existing marker
  if (currentMarker) {
    currentMarker.remove();
    currentMarker = null;
  }

  // filter by selected tags
  const selTags = Array.from(document.querySelectorAll('.tag'))
    .filter(el => !el.classList.contains('deselected'))
    .map(el => el.dataset.tag);
  let candidates = DATA.targets;
  if (selTags.length) {
    const filtered = DATA.targets.filter(t => selTags.includes(t.tag));
    if (filtered.length) candidates = filtered;
  }

  // find closest by distance
  const closest = candidates
    .map(t => ({ ...t, dist: haversine(userLat, userLon, t.lat, t.lon) }))
    .sort((a, b) => a.dist - b.dist)[0];
  currentTarget = closest;

  // render marker and keep reference
  currentMarker = L.circleMarker([closest.lat, closest.lon], {
    radius: 8, color: COLORS.primary, weight: 2, fillOpacity: 1
  }).addTo(map);

  // route to it
  drawRoute([closest]);

  // build content bar
  descBar.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'titleRow';

  const tagEl = document.createElement('span');
  tagEl.className = 'tag';
  tagEl.textContent = closest.tag;
  row.appendChild(tagEl);

  const headline = document.createElement('div');
  headline.className = 'title-text';
  headline.textContent = closest.name;
  row.appendChild(headline);

  const btn = document.createElement('button');
  btn.className = 'collapse-btn';
  btn.textContent = '▾';
  row.appendChild(btn);

  descBar.appendChild(row);

  const desc = document.createElement('div');
  desc.textContent = closest.desc;
  desc.style.marginTop = '8px';
  descBar.appendChild(desc);

  btn.addEventListener('click', () => {
    const hidden = desc.style.display === 'none';
    desc.style.display = hidden ? 'block' : 'none';
    btn.textContent = hidden ? '▾' : '▴';
  });

  descBar.style.opacity = '1';
}

/* ---------- Routing via OSRM ---------- */
function drawRoute(list) {(list) {
  const waypts = [[userLat,userLon], ...list.map(t=>[t.lat,t.lon])];
  if (routeControl) routeControl.setWaypoints(waypts);
  else {
    routeControl = L.Routing.control({
      router: L.Routing.osrmv1({ serviceUrl: 'https://router.project-osrm.org/route/v1' }),
      waypoints: waypts,
      lineOptions: { styles: [{ color:'#000', weight:3 }] },
      createMarker: () => null,
      addWaypoints: false,
      draggableWaypoints: false,
      fitSelectedRoutes: false,
      showAlternatives: false,
      show: false
    }).addTo(map);
    document.querySelectorAll('.leaflet-routing-container').forEach(el => el.style.display = 'none');
  }
}

/* ---------- Math ---------- */
function haversine(a,b,c,d) {
  const R=6371e3, φ1=toRad(a), φ2=toRad(c), dφ=toRad(c-a), dλ=toRad(d-b);
  const A=Math.sin(dφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(dλ/2)**2;
  return R*2*Math.atan2(Math.sqrt(A), Math.sqrt(1-A));
}
