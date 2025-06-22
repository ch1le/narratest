/* App.js: Mobile Orientation HUD – directional chain with controls restored */

/* ---------- Helpers ---------- */
const $ = sel => document.querySelector(sel);
const norm = d => (d % 360 + 360) % 360;
const toRad = d => d * Math.PI / 180;
const shortest = (a, b) => ((a - b + 540) % 360) - 180;

/* ---------- DOM Refs ---------- */
const enableBtn      = document.getElementById('enable');
const permissionBox  = document.getElementById('permissionBox');
const permissionText = document.getElementById('permissionText');
const selectorRow    = document.getElementById('selectorRow');
const descBar        = document.getElementById('descBox');
const mapContainer   = document.getElementById('map');
const loader         = document.getElementById('loader');

/* ---------- Constants ---------- */
const COLORS = { primary: '#000', chain: '#006400', compass: '#0066ff', all: '#888' };

/* ---------- State ---------- */
let DATA, map, userLat, userLon, initialAlpha = null;
let compassMarker, routeControl;
let chain = [], markers = [], allMarkers = [], revealingAll = false;

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
  permissionBox.remove();
  buildMap();
  addCompass();
  setupReveal();
  setupRandomize();
  generateChain(0);
  updateMarkers();
  // fit map to initial chain and draw route
  map.fitBounds(L.featureGroup(markers).getBounds().pad(0.1));
  drawRoute(chain);
  updateContentBar();
  map.on('zoomend', updateContentBar);
  window.addEventListener('deviceorientation', onOrientation);
}

/* ---------- Map & Compass ---------- */
function buildMap() {
  map = L.map('map',{zoomControl:false,attributionControl:false})
    .setView([userLat,userLon],14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
}
function addCompass() {
  const html = `<div class='compass-icon'><svg width='28' height='28'>`+
               `<polygon points='14,3 18,19 14,15 10,19' fill='${COLORS.compass}'/></svg></div>`;
  compassMarker = L.marker([userLat,userLon],{
    icon:L.divIcon({html,className:'',iconSize:[28,28],iconAnchor:[14,14]})
  }).addTo(map);
}

/* ---------- Reveal/Hide All Markers ---------- */
function setupReveal() {
  allMarkers = DATA.targets.map(t =>
    L.circleMarker([t.lat,t.lon],{radius:6,color:COLORS.all,weight:1,fillOpacity:1})
  );
  const btn = document.createElement('button');
  btn.textContent = 'Reveal';
  Object.assign(btn.style,{position:'fixed',bottom:'16px',left:'16px',padding:'8px',background:'red',color:'#fff',border:'none',borderRadius:'4px',zIndex:30,cursor:'pointer'});
  document.body.appendChild(btn);
  btn.addEventListener('click',()=>{
    revealingAll = !revealingAll;
    allMarkers.forEach(m=>revealingAll?m.addTo(map):m.remove());
    btn.textContent = revealingAll?'Hide':'Reveal';
  });
}

/* ---------- Randomize Location ---------- */
function setupRandomize() {
  const btn = document.createElement('button');
  btn.textContent = 'Randomize';
  Object.assign(btn.style,{position:'fixed',bottom:'16px',right:'16px',padding:'8px',background:'red',color:'#fff',border:'none',borderRadius:'4px',zIndex:30,cursor:'pointer'});
  document.body.appendChild(btn);
  btn.addEventListener('click',()=>{
    const R=6371e3, d=Math.random()*1000, brng=Math.random()*2*Math.PI;
    const lat1=toRad(58.377679), lon1=toRad(26.717398);
    const lat2=Math.asin(Math.sin(lat1)*Math.cos(d/R)+Math.cos(lat1)*Math.sin(d/R)*Math.cos(brng));
    const lon2=lon1+Math.atan2(Math.sin(brng)*Math.sin(d/R)*Math.cos(lat1),Math.cos(d/R)-Math.sin(lat1)*Math.sin(lat2));
    userLat=lat2*180/Math.PI; userLon=lon2*180/Math.PI;
    const cmLayer = Object.values(map._layers).find(l=>l.options&&l.options.icon);
    if(cmLayer) cmLayer.setLatLng([userLat,userLon]);
    map.setView([userLat,userLon],14);
    generateChain(initialAlpha||0);
    updateMarkers();
    // update route after randomize
    drawRoute(chain);
    updateContentBar();
  });
}

/* ---------- Chain Generation (closest by route) ---------- */
function generateChain(heading) {
  if (!DATA) return;
  // find closest target by straight-line distance (approximate)
  const byDist = DATA.targets.map(t => ({
    ...t,
    dist: haversine(userLat, userLon, t.lat, t.lon)
  })).sort((a, b) => a.dist - b.dist);
  // only closest point
  chain = [byDist[0]];
}

/* ---------- Markers Update ---------- */
function updateMarkers() {
  markers.forEach(m=>m.remove()); markers=[];
  chain.forEach((t,i)=>{
    const color=i===0?COLORS.primary:COLORS.chain;
    const m=L.circleMarker([t.lat,t.lon],{radius:6,color,weight:1,fillOpacity:1})
      .addTo(map)
      .on('click',()=>focusOn(i));
    markers.push(m);
  });
}

/* ---------- Focus & Routing ---------- */
function focusOn(idx) {
  const sub=chain.slice(0,idx+1);
  map.fitBounds(L.featureGroup(sub.map((_,i)=>markers[i])).getBounds().pad(0.1));
  drawRoute(sub);
  updateContentBar(sub.length);
}
function drawRoute(list) {
  const waypts = [[userLat, userLon], ...list.map(t => [t.lat, t.lon])];
  if (routeControl) {
    routeControl.setWaypoints(waypts);
  } else {
    // use OpenRouteService walking profile
    routeControl = L.Routing.control({
      router: L.Routing.openrouteservice(
        "5b3ce3597851110001cf624832d9077792624247bec931918dc4e43b", // ORS API key
        { profile: "foot-walking" }
      ),
      waypoints: waypts,
      lineOptions: { styles: [{ color: '#000', weight: 3 }] },
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

/* ---------- Content Bar */ ---------- */
function updateContentBar(count = null) {
  const b = map.getBounds();
  let vis = chain.filter((t, i) => b.contains([t.lat, t.lon]));
  if (count != null) vis = chain.slice(0, count);
  descBar.innerHTML = '';
  vis.forEach((t, i) => {
    const r = document.createElement('div');
    r.textContent = t.name;
    Object.assign(r.style, { fontSize: `${20 - i * 2}px`, fontWeight: '500', cursor: 'pointer' });
    descBar.appendChild(r);
    if (vis.length === 1) {
      const d = document.createElement('div');
      d.textContent = t.desc;
      d.style.marginTop = '8px';
      descBar.appendChild(d);
    }
  });
  // ensure content bar is visible
  descBar.style.opacity = '1';
}
/* ---------- Orientation Handler ---------- */
function onOrientation({alpha}){
  if(alpha==null) return;
  initialAlpha=alpha;
  const h=norm(alpha);
  generateChain(h);
  updateMarkers();
  updateContentBar();
  if(compassMarker){compassMarker.getElement().querySelector('svg').style.transform=`rotate(${h}deg)`;}  
}

/* ---------- Math ---------- */
function haversine(a,b,c,d){const R=6371e3,φ1=toRad(a),φ2=toRad(c),dφ=toRad(c-a),dλ=toRad(d-b),A=Math.sin(dφ/2)**2+Math.cos(φ1)*Math.cos(φ2)*Math.sin(dλ/2)**2;return R*2*Math.atan2(Math.sqrt(A),Math.sqrt(1-A));}
function bearing(a,b,c,d){const y=Math.sin(toRad(d-b))*Math.cos(toRad(c)),x=Math.cos(toRad(a))*Math.sin(toRad(c))-Math.sin(toRad(a))*Math.cos(toRad(c))*Math.cos(toRad(d-b));return norm(Math.atan2(y,x)*180/Math.PI);}
