/* App.js: Mobile Orientation HUD – Refactored for Endless Chaining */

/* ---------- Helpers ---------- */
const $ = sel => document.querySelector(sel);
const norm = d => (d % 360 + 360) % 360;
const toRad = d => d * Math.PI / 180;
const shortest = (a, b) => ((a - b + 540) % 360) - 180;

/* ---------- DOM Refs ---------- */
const enableBtn      = $("#enable");
const permissionBox  = $("#permissionBox");
const permissionText = $("#permissionText");
const selectorRow    = $("#selectorRow");
const descBox        = $("#descBox");
const bookmark       = $("#bookmark");
const loader         = $("#loader");

/* ---------- Constants ---------- */
const VIEW_TOL    = 20;
const SPOKE_TOL   = 25;
const SPOKE_ANGLE = 120;
const COLORS = {
  primary:  "#000",
  chain:    "#006400",
  compass:  "#0066ff",
  all:      "#888"
};

/* ---------- State ---------- */
let DATA, map, userLat, userLon, initialAlpha = null;
let markers = [];  // holds all active markers in order of chain
let allMarkers = [];
let routeControl;

/* ---------- Load JSON + Mock Location ---------- */
Promise.all([
  fetch("content.json").then(r => r.json()),
  new Promise(res => {
    const USE_MOCK = true;
    if (USE_MOCK) {
      userLat = 58.377679;
      userLon = 26.717398;
      res();
    } else {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => { userLat = coords.latitude; userLon = coords.longitude; res(); },
        err => alert(err.message)
      );
    }
  })
]).then(([json]) => {
  DATA = json;
  permissionText.textContent = json.permissionMessage.replace(/\n/g,'\n');
});

/* ---------- Tag Selector Toggle ---------- */
selectorRow.addEventListener("click", e => {
  if (e.target.classList.contains("tag")) {
    e.target.classList.toggle("deselected");
    if (map) pickPrimaryTargets();
  }
});

/* ---------- Permission & Start ---------- */
enableBtn.addEventListener("click", startPresent);
function startPresent() {
  const hb = document.getElementById('headerBar'); if (hb) hb.remove();
  permissionBox.remove();
  initMap();
  addCompass();
  setupAllMarkers();
  introVisuals();
  pickPrimaryTargets();

  // Randomize location button
  const rndBtn = document.createElement('button');
  rndBtn.textContent = 'Randomize';
  Object.assign(rndBtn.style, {
    position: 'fixed',
    bottom: '16px',
    right: '16px',
    padding: '8px',
    background: 'red',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    zIndex: 30,
    cursor: 'pointer'
  });
  document.body.appendChild(rndBtn);
  rndBtn.addEventListener('click', () => {
    const R = 6371e3;
    const d = Math.random() * 1000;
    const brng = Math.random() * 2 * Math.PI;
    const lat1 = toRad(58.377679), lon1 = toRad(26.717398);
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d / R) +
      Math.cos(lat1) * Math.sin(d / R) * Math.cos(brng)
    );
    const lon2 = lon1 + Math.atan2(
      Math.sin(brng) * Math.sin(d / R) * Math.cos(lat1),
      Math.cos(d / R) - Math.sin(lat1) * Math.sin(lat2)
    );
    userLat = (lat2 * 180) / Math.PI;
    userLon = (lon2 * 180) / Math.PI;
    // move compass marker and recenter
    const compassLayer = Object.values(map._layers).find(l => l.options && l.options.icon);
    if (compassLayer) compassLayer.setLatLng([userLat, userLon]);
    map.setView([userLat, userLon], 14);
    pickPrimaryTargets();
  });
  window.addEventListener("deviceorientation", handleOrientation);
}

/* ---------- Map & Compass ---------- */
function initMap() {
  map = L.map("map", { zoomControl:false, attributionControl:false })
    .setView([userLat, userLon], 14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19}).addTo(map);
}
function addCompass() {
  const html = `<div class='compass-icon'><svg width='28' height='28'><polygon points='14,3 18,19 14,15 10,19' fill='${COLORS.compass}'/></svg></div>`;
  L.marker([userLat, userLon], {
    icon: L.divIcon({html, className:'', iconSize:[28,28], iconAnchor:[14,14]})
  }).addTo(map).bindTooltip("You");
}

/* ---------- Reveal All ---------- */
function setupAllMarkers() {
  allMarkers = DATA.targets.map(t => L.circleMarker([t.lat,t.lon],{radius:6,color:COLORS.all,weight:1,fillOpacity:1}));
  // Create Reveal/Hide button using standard DOM API
  const btn = document.createElement('button');,'');
  btn.textContent='Reveal';
  Object.assign(btn.style,{position:'fixed',bottom:'16px',left:'16px',padding:'8px',background:'red',color:'#fff',border:'none',borderRadius:'4px',zIndex:30,cursor:'pointer'});
  document.body.appendChild(btn);
  btn.addEventListener('click',()=>{
    const show = btn.textContent==='Reveal';
    allMarkers.forEach(m=> show? m.addTo(map): m.remove());
    btn.textContent = show? 'Hide':'Reveal';
  });
}

/* ---------- Pick Primary 3 Targets ---------- */
function pickPrimaryTargets() {
  clearChain();
  const tags = Array.from(document.querySelectorAll('.tag'))
    .filter(el=>!el.classList.contains('deselected')).map(el=>el.dataset.tag);
  let candidates = DATA.targets.filter(t=>tags.includes(t.tag));
  if (!candidates.length) candidates = DATA.targets;
  const list = candidates.map(t=>({
    ...t,
    dist: haversine(userLat,userLon,t.lat,t.lon),
    bear: bearing(userLat,userLon,t.lat,t.lon)
  })).sort((a,b)=>a.dist-b.dist);
  const first = list[0];
  const spokes = [norm(first.bear+SPOKE_ANGLE), norm(first.bear-SPOKE_ANGLE)];
  const pick = dir=> list.filter(x=>Math.abs(shortest(dir,x.bear))<SPOKE_TOL).sort((a,b)=>a.dist-b.dist)[0];
  const chain = [first, pick(spokes[0]), pick(spokes[1])].filter(Boolean);
  renderChain(chain);
}

/* ---------- Render Chain & Markers ---------- */
function clearChain(){
  markers.forEach(m=>m.remove()); markers=[];
  if(routeControl) routeControl.setWaypoints([]);
}
function renderChain(chain) {
  clearChain();
  chain.forEach((pt,index)=>{
    const color = index===0? COLORS.primary : COLORS.chain;
    const m = L.circleMarker([pt.lat,pt.lon],{radius:6,color,weight:1,fillOpacity:1})
      .addTo(map)
      .on('click',()=> expandChain(chain,index));
    m.chainIndex=index;
    markers.push(m);
  });
  fitMap(markers);
  drawUI(chain);
  drawRoute([ [userLat,userLon], ...chain.map(p=>[p.lat,p.lon]) ]);
}
function expandChain(chain, idx) {
  // pivot at chain[idx]
  const pivot = chain[idx];
  const excludeNames = chain.map(p=>p.name);
  const candidates = DATA.targets.filter(t=>!excludeNames.includes(t.name))
    .map(t=>({ ...t, dist:haversine(pivot.lat,pivot.lon,t.lat,t.lon) }))
    .sort((a,b)=>a.dist-b.dist).slice(0,2);
  const newChain = [...chain.slice(0,idx+1), ...candidates];
  renderChain(newChain);
}

/* ---------- Fit Map ---------- */
function fitMap(ms) {
  const group = L.featureGroup(ms);
  map.fitBounds(group.getBounds().pad(0.2));
}

/* ---------- Draw UI ---------- */
function drawUI(chain) {
  descBox.innerHTML='';
  chain.forEach((pt,i)=>{
    const size = ['20pt','18pt','16pt'][Math.min(i,2)];
    const row = document.createElement('div');
    Object.assign(row.style,{display:'flex',alignItems:'center',gap:'8px'});
    const tag = document.createElement('span'); tag.className='tag'; tag.textContent=pt.tag; row.appendChild(tag);
    const title = document.createElement('div'); title.textContent=pt.name;
    Object.assign(title.style,{fontSize:size,fontWeight:'500'}); row.appendChild(title);
    if(i<chain.length-1){
      const btn = document.createElement('button'); btn.textContent='▾';
      Object.assign(btn.style,{marginLeft:'auto',background:'none',border:'none',fontSize:'18px',cursor:'pointer'});
      row.appendChild(btn);
      const desc = document.createElement('div'); desc.textContent=pt.desc;
      Object.assign(desc.style,{marginTop:'4px',display:'none'});
      btn.addEventListener('click',() => {
        const hidden = desc.style.display==='none';
        desc.style.display = hidden?'block':'none';
        btn.textContent = hidden?'▾':'▴';
      });
      descBox.appendChild(row);
      descBox.appendChild(desc);
      const hr = document.createElement('hr'); Object.assign(hr.style,{border:'none',borderTop:'1px solid #ccc',margin:'8px 0'});
      descBox.appendChild(hr);
    } else {
      descBox.appendChild(row);
      const desc = document.createElement('div'); desc.textContent=pt.desc; desc.style.marginTop='4px';
      descBox.appendChild(desc);
    }
  });
  descBox.style.opacity='1';
}

/* ---------- Draw Route ---------- */
function drawRoute(waypoints) {
  if(routeControl) {
    routeControl.setWaypoints(waypoints);
  } else {
    routeControl = L.Routing.control({
      router: L.Routing.osrmv1({serviceUrl:'https://router.project-osrm.org/route/v1'}),
      waypoints,
      lineOptions:{styles:[{color:'#000',weight:3}]},
      createMarker:()=>null,addWaypoints:false,
      draggableWaypoints:false,fitSelectedRoutes:false,
      showAlternatives:false,show:false
    }).addTo(map);
    document.querySelectorAll('.leaflet-routing-container').forEach(el=>el.style.display='none');
  }
}

/* ---------- Orientation ---------- */
function handleOrientation({alpha=0}){
  if(!DATA) return;
  alpha = norm(alpha);
  if(initialAlpha===null) initialAlpha=alpha;
  const heading = norm(initialAlpha-alpha);
  const c = map._layers[Object.keys(map._layers).find(k=>map._layers[k].options&&map._layers[k].options.icon)];
  c.getElement().querySelector('svg').style.transform=`rotate(${heading}deg)`;
}

/* ---------- Math ---------- */
function haversine(a,b,c,d){const R=6371e3,φ1=toRad(a),φ2=toRad(c),dφ=toRad(c-a),dλ=toRad(d-b);const A=Math.sin(dφ/2)**2+Math.cos(φ1)*Math.cos(φ2)*Math.sin(dλ/2)**2;return R*2*Math.atan2(Math.sqrt(A),Math.sqrt(1-A))}
function bearing(a,b,c,d){const y=Math.sin(toRad(d-b))*Math.cos(toRad(c)),x=Math.cos(toRad(a))*Math.sin(toRad(c))-Math.sin(toRad(a))*Math.cos(toRad(c))*Math.cos(toRad(d-b));return norm(Math.atan2(y,x)*180/Math.PI)}
