/* App.js: Mobile Orientation HUD – Simplest closest-point routing */

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
const COLORS = { primary: '#000', all: '#888', compass: '#0066ff' };

/* ---------- State ---------- */
let DATA;
let map;
let userLat, userLon;
let compassMarker;
let routeControl;
let currentTarget = null;
let allMarkers = [];
let revealingAll = false;

/* ---------- Initialization ---------- */
Promise.all([
  fetch('content.json').then(r => r.json()),
  new Promise(res => {
    // use mock location
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
  // ensure map container has visible dimensions
  mapContainer.style.width = '100%';
  mapContainer.style.height = '50vh';

  permissionBox.remove();
  permissionBox.remove();
  buildMap();
  // after initializing map, fix size
  map.invalidateSize();
  addCompass();
  setupReveal();
  setupRandomize();
  pickAndRender();
  map.on('zoomend', updateContentBar);
}

/* ---------- Map & Compass ---------- */
function buildMap() {
  map = L.map('map', { zoomControl:false, attributionControl:false })
    .setView([userLat, userLon], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
}
function addCompass() {
  const html = `<div class='compass-icon'><svg width='28' height='28'>` +
               `<polygon points='14,3 18,19 14,15 10,19' fill='${COLORS.compass}'/></svg></div>`;
  compassMarker = L.marker([userLat, userLon], {
    icon: L.divIcon({ html, className:'', iconSize:[28,28],iconAnchor:[14,14] })
  }).addTo(map);
}

/* ---------- Reveal/Hide All ---------- */
function setupReveal() {
  allMarkers = DATA.targets.map(t =>
    L.circleMarker([t.lat, t.lon], { radius:6, color:COLORS.all, weight:1, fillOpacity:1 })
  );
  const btn = document.createElement('button');
  btn.textContent = 'Reveal';
  Object.assign(btn.style, { position:'fixed', bottom:'16px', left:'16px', padding:'8px', background:'red', color:'#fff', border:'none', borderRadius:'4px', zIndex:30, cursor:'pointer' });
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
  Object.assign(btn.style, { position:'fixed', bottom:'16px', right:'16px', padding:'8px', background:'red', color:'#fff', border:'none', borderRadius:'4px', zIndex:30, cursor:'pointer' });
  document.body.appendChild(btn);
  btn.addEventListener('click', () => {
    // random within 1km
    const R=6371e3, d=Math.random()*1000, brng=Math.random()*2*Math.PI;
    const lat1=toRad(58.377679), lon1=toRad(26.717398);
    const lat2=Math.asin(Math.sin(lat1)*Math.cos(d/R)+Math.cos(lat1)*Math.sin(d/R)*Math.cos(brng));
    const lon2=lon1+Math.atan2(Math.sin(brng)*Math.sin(d/R)*Math.cos(lat1), Math.cos(d/R)-Math.sin(lat1)*Math.sin(lat2));
    userLat=lat2*180/Math.PI; userLon=lon2*180/Math.PI;
    compassMarker.setLatLng([userLat, userLon]);
    map.setView([userLat, userLon],14);
    pickAndRender();
  });
}

/* ---------- Pick & Render ---------- */
function pickAndRender() {
  // clear old
  if (currentTarget && routeControl) routeControl.setWaypoints([]);
  map.eachLayer(l => { if (l instanceof L.CircleMarker && !DATA.targets.some(t=>t.lat===l.getLatLng().lat&&t.lon===l.getLatLng().lng)) map.removeLayer(l); });

  // pick closest by Haversine
  const closest = DATA.targets.map(t => ({ ...t, dist: haversine(userLat, userLon, t.lat, t.lon) }))
                     .sort((a,b) => a.dist - b.dist)[0];
  currentTarget = closest;

  // render marker
  L.circleMarker([closest.lat, closest.lon], { radius:8, color:COLORS.primary, weight:2, fillOpacity:1 }).addTo(map);

  // draw route via OSRM
  drawRoute([closest]);

  // update content bar
  descBar.innerHTML = '';
  const title = document.createElement('div'); title.textContent = closest.name;
  Object.assign(title.style, { fontSize:'20pt', fontWeight:'500' });
  descBar.appendChild(title);
  const desc = document.createElement('div'); desc.textContent = closest.desc; desc.style.marginTop='8px';
  descBar.appendChild(desc);
  descBar.style.opacity = '1';
}

/* ---------- Routing ---------- */
function drawRoute(list) {
  const waypts = [[userLat, userLon], ...list.map(t=>[t.lat,t.lon])];
  if (routeControl) routeControl.setWaypoints(waypts);
  else routeControl = L.Routing.control({
    router: L.Routing.osrmv1({ serviceUrl:'https://router.project-osrm.org/route/v1' }),
    waypoints: waypts,
    lineOptions:{styles:[{color:'#000',weight:3}]},
    createMarker:()=>null, addWaypoints:false, draggableWaypoints:false,
    fitSelectedRoutes:false, showAlternatives:false, show:false
  }).addTo(map);
  document.querySelectorAll('.leaflet-routing-container').forEach(el=>el.style.display='none');
}

/* ---------- Math ---------- */
function haversine(a,b,c,d){const R=6371e3,φ1=toRad(a),φ2=toRad(c),dφ=toRad(c-a),dλ=toRad(d-b),A=Math.sin(dφ/2)**2+Math.cos(φ1)*Math.cos(φ2)*Math.sin(dλ/2)**2;return R*2*Math.atan2(Math.sqrt(A),Math.sqrt(1-A));}
function bearing(a,b,c,d){const y=Math.sin(toRad(d-b))*Math.cos(toRad(c)),x=Math.cos(toRad(a))*Math.sin(toRad(c))-Math.sin(toRad(a))*Math.cos(toRad(c))*Math.cos(toRad(d-b));return norm(Math.atan2(y,x)*180/Math.PI);}
