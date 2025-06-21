/* App.js: Mobile Orientation HUD – auto-generated chain with zoom-based content bar */

/* ---------- Helpers ---------- */
const $ = sel => document.querySelector(sel);
const norm = d => (d % 360 + 360) % 360;
const toRad = d => d * Math.PI / 180;

/* ---------- DOM Refs ---------- */
const enableBtn      = $('#enable');
const permissionBox  = $('#permissionBox');
const permissionText = $('#permissionText');
const selectorRow    = $('#selectorRow');
const descBar        = $('#descBox');   // content bar below map
const mapContainer   = $('#map');
const bookmark       = $('#bookmark');
const loader         = $('#loader');

/* ---------- Constants ---------- */
const COLORS = { primary: '#000', chain: '#006400', compass: '#0066ff', all: '#888' };

/* ---------- State ---------- */
let DATA, map, userLat, userLon, initialAlpha = null;
let compassMarker, routeControl;
let chain = []; // full chain of targets ordered by current heading
let markers = [];

/* ---------- Initialize ---------- */
Promise.all([
  fetch('content.json').then(r=>r.json()),
  new Promise(res=>{
    // mock location
    userLat = 58.377679; userLon = 26.717398; res();
  })
]).then(([json])=>{
  DATA = json;
  permissionText.textContent = json.permissionMessage.replace(/\n/g,'\n');
});

enableBtn.addEventListener('click', startPresent);
function startPresent() {
  permissionBox.remove();
  buildMap();
  addCompass();
  generateChain(0); // initial orientation=0
  updateMarkers();
  updateContentBar();
  map.on('zoomend', updateContentBar);
  window.addEventListener('deviceorientation', onOrientation);
}

/* ---------- Map Setup ---------- */
function buildMap(){
  map = L.map('map',{zoomControl:false,attributionControl:false})
    .setView([userLat,userLon],14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
}

/* ---------- Compass ---------- */
function addCompass(){
  const html = `<div class='compass-icon'><svg width='28' height='28'>`+
               `<polygon points='14,3 18,19 14,15 10,19' fill='${COLORS.compass}'/></svg></div>`;
  compassMarker = L.marker([userLat,userLon],{
    icon:L.divIcon({html,className:'',iconSize:[28,28],iconAnchor:[14,14]})
  }).addTo(map);
}

/* ---------- Chain Generation ---------- */
function generateChain() {
  if (!DATA) return;
  // 1. Primary: the closest target to user
  const byDist = DATA.targets.map(t => ({
    ...t,
    dist: haversine(userLat, userLon, t.lat, t.lon)
  })).sort((a,b) => a.dist - b.dist);
  const primary = byDist[0];

  // 2. Compute vector bearing from user to primary
  const vectorBear = bearing(userLat, userLon, primary.lat, primary.lon);

  // 3. From primary, pick two next targets that continue vector
  const others = DATA.targets.filter(t => t.name !== primary.name);
  const secondary = others.map(t => ({
    ...t,
    bear: bearing(primary.lat, primary.lon, t.lat, t.lon),
    dist: haversine(primary.lat, primary.lon, t.lat, t.lon)
  }))
  .sort((a,b) => Math.abs(shortest(a.bear, vectorBear)) - Math.abs(shortest(b.bear, vectorBear))
             || a.dist - b.dist)
  .slice(0,2);

  // 4. Build chain
  chain = [primary, ...secondary];
}
}

/* ---------- Focus & Routing ---------- */
function focusOn(idx){
  const subChain = chain.slice(0, idx+1);
  map.fitBounds(L.featureGroup(subChain.map((t,i)=>markers[i])).getBounds().pad(0.1));
  drawRoute(subChain);
  updateContentBar(subChain.length);
}

function drawRoute(list){
  const waypts = [[userLat,userLon], ...list.map(t=>[t.lat,t.lon])];
  if(routeControl) routeControl.setWaypoints(waypts);
  else {
    routeControl = L.Routing.control({
      router: L.Routing.osrmv1({serviceUrl:'https://router.project-osrm.org/route/v1'}),
      waypoints: waypts,
      lineOptions:{styles:[{color:'#000',weight:3}]},
      createMarker:()=>null,addWaypoints:false,
      draggableWaypoints:false,fitSelectedRoutes:false,
      showAlternatives:false,show:false
    }).addTo(map);
    document.querySelectorAll('.leaflet-routing-container').forEach(el=>el.style.display='none');
  }
}

/* ---------- Content Bar ---------- */
function updateContentBar(visibleCount=null){
  const bounds = map.getBounds();
  let visible = chain.filter((t,i)=> bounds.contains([t.lat,t.lon]));
  if(visibleCount!==null) visible = chain.slice(0,visibleCount);
  descBar.innerHTML = '';
  visible.forEach((t,i)=>{
    const row = document.createElement('div');
    row.textContent = t.name;
    Object.assign(row.style,{fontSize:`${20 - i*2}px`,fontWeight:'500',cursor:'pointer'});
    descBar.appendChild(row);
    if(visible.length===1){
      const d = document.createElement('div'); d.textContent=t.desc;
      d.style.marginTop='8px'; descBar.appendChild(d);
    }
  });
}

/* ---------- Orientation Handler ---------- */
function onOrientation({alpha}){
  if(alpha==null) return;
  const h = norm(alpha);
  generateChain(h);
  updateMarkers();
  updateContentBar();
  if(compassMarker){
    compassMarker.getElement().querySelector('svg').style.transform = `rotate(${h}deg)`;
  }
}

/* ---------- Math (unused) ---------- */
function haversine(a,b,c,d){ /* omitted */ }
function bearing(a,b,c,d){ /* omitted */ }
