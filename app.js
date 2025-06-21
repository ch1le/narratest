/* App.js: Mobile Orientation HUD – Refactored for Endless Chaining */

/* ---------- Helpers ---------- */
const $ = sel => document.querySelector(sel);
const norm = d => (d % 360 + 360) % 360;
const toRad = d => d * Math.PI / 180;
const shortest = (a, b) => ((a - b + 540) % 360) - 180;

/* ---------- DOM Refs ---------- */
const enableBtn      = document.getElementById("enable");
const permissionBox  = document.getElementById("permissionBox");
const permissionText = document.getElementById("permissionText");
const selectorRow    = document.getElementById("selectorRow");
const descBox        = document.getElementById("descBox");
const bookmark       = document.getElementById("bookmark");
const loader         = document.getElementById("loader");

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
let markers = [];  // holds active chain markers
let allMarkers = [];
let routeControl;

/* ---------- Load content + Mock location ---------- */
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
  permissionText.textContent = json.permissionMessage;
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
  setupRandomize();
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
  const marker = L.marker([userLat, userLon], {
    icon: L.divIcon({ html, className:'', iconSize:[28,28], iconAnchor:[14,14] })
  }).addTo(map);
  marker.bindTooltip('You');
}

/* ---------- Reveal All ---------- */
function setupAllMarkers() {
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
    const show = btn.textContent === 'Reveal';
    allMarkers.forEach(m => show ? m.addTo(map) : m.remove());
    btn.textContent = show ? 'Hide' : 'Reveal';
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
    const R = 6371e3, d = Math.random() * 1000, brng = Math.random() * 2 * Math.PI;
    const lat1 = toRad(58.377679), lon1 = toRad(26.717398);
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d/R) +
      Math.cos(lat1) * Math.sin(d/R) * Math.cos(brng)
    );
    const lon2 = lon1 + Math.atan2(
      Math.sin(brng) * Math.sin(d/R) * Math.cos(lat1),
      Math.cos(d/R) - Math.sin(lat1) * Math.sin(lat2)
    );
    userLat = lat2 * 180/Math.PI;
    userLon = lon2 * 180/Math.PI;
    // update compass
    const layers = Object.values(map._layers);
    const cm = layers.find(l => l.options && l.options.icon);
    if (cm) cm.setLatLng([userLat, userLon]);
    map.setView([userLat, userLon], 14);
    pickPrimaryTargets();
  });
}

/* ---------- Pick Primary Targets ---------- */
function pickPrimaryTargets() {
  clearChain();
  const tags = Array.from(document.querySelectorAll('.tag'))
    .filter(el => !el.classList.contains('deselected'))
    .map(el => el.dataset.tag);
  let candidates = DATA.targets.filter(t => tags.includes(t.tag));
  if (!candidates.length) candidates = DATA.targets;
  const list = candidates.map(t => ({
    ...t,
    dist: haversine(userLat, userLon, t.lat, t.lon),
    bear: bearing(userLat, userLon, t.lat, t.lon)
  })).sort((a, b) => a.dist - b.dist);
  const first = list[0];
  const spokes = [norm(first.bear+SPOKE_ANGLE), norm(first.bear-SPOKE_ANGLE)];
  const pick = dir => list.filter(x=>Math.abs(shortest(dir,x.bear))<SPOKE_TOL)
                            .sort((a,b)=>a.dist-b.dist)[0];
  const chain = [first, pick(spokes[0]), pick(spokes[1])].filter(Boolean);
  renderChain(chain);
}

/* ---------- Render Chain & Markers ---------- */
function clearChain() {
  markers.forEach(m=>m.remove()); markers = [];
}
function renderChain(chain) {
  clearChain();
  chain.forEach((pt, i) => {
    const color = i===0 ? COLORS.primary : COLORS.chain;
    const m = L.circleMarker([pt.lat, pt.lon], { radius:6, color, weight:1, fillOpacity:1 })
      .addTo(map)
      .on('click', () => expandChain(chain, i));
    markers.push(m);
  });
  fitMap();
  drawUI(chain);
  drawRoute(chain);
}
function expandChain(chain, idx) {
  const pivot = chain[idx];
  const exclude = chain.map(p=>p.name);
  const next = DATA.targets.filter(t=>!exclude.includes(t.name))
    .map(t=>({...t,dist:haversine(pivot.lat,pivot.lon,t.lat,t.lon)}))
    .sort((a,b)=>a.dist-b.dist).slice(0,2);
  const newChain = [...chain.slice(0,idx+1), ...next];
  renderChain(newChain);
}

/* ---------- Fit Map to Chain ---------- */
function fitMap() {
  const grp = L.featureGroup(markers);
  map.fitBounds(grp.getBounds().pad(0.2));
}

/* ---------- Draw UI ---------- */
function drawUI(chain) {
  descBox.innerHTML = '';
  chain.forEach((pt, i) => {
    const size = ['20pt','18pt','16pt'][Math.min(i,2)];
    const row = document.createElement('div');
    Object.assign(row.style,{display:'flex',alignItems:'center',gap:'8px'});
    const tag = document.createElement('span'); tag.className='tag'; tag.textContent=pt.tag;
    row.appendChild(tag);
    const title = document.createElement('div'); title.textContent=pt.name;
    Object.assign(title.style,{fontSize:size,fontWeight:'500'});
    row.appendChild(title);
    if(i<chain.length-1) {
      const btn=document.createElement('button'); btn.textContent='▾';
      Object.assign(btn.style,{marginLeft:'auto',background:'none',border:'none',fontSize:'18px',cursor:'pointer'});
      const desc=document.createElement('div'); desc.textContent=pt.desc;
      Object.assign(desc.style,{marginTop:'4px',display:'none'});
      btn.addEventListener('click',()=>{
        const hidden=desc.style.display==='none';
        desc.style.display=hidden?'block':'none'; btn.textContent=hidden?'▾':'▴';
      });
      descBox.appendChild(row); descBox.appendChild(desc);
      const hr=document.createElement('hr'); Object.assign(hr.style,{border:'none',borderTop:'1px solid #ccc',margin:'8px 0'});
      descBox.appendChild(hr);
    } else {
      descBox.appendChild(row);
      const d=document.createElement('div'); d.textContent=pt.desc; d.style.marginTop='4px';
      descBox.appendChild(d);
    }
  });
  descBox.style.opacity='1';
}

/* ---------- Draw Route ---------- */
function drawRoute(chain) {
  const waypoints = [ [userLat, userLon], ...chain.map(p=>[p.lat,p.lon]) ];
  if(routeControl) routeControl.setWaypoints(waypoints);
  else {
    routeControl = L.Routing.control({
      router:L.Routing.osrmv1({serviceUrl:'https://router.project-osrm.org/route/v1'}),
      waypoints, lineOptions:{styles:[{color:'#000',weight:3}]},
      createMarker:()=>null,addWaypoints:false,draggableWaypoints:false,
      fitSelectedRoutes:false,showAlternatives:false,show:false
    }).addTo(map);
    document.querySelectorAll('.leaflet-routing-container').forEach(el=>el.style.display='none');
  }
}

/* ---------- Orientation ---------- */
function handleOrientation({alpha=0}){
  if(!DATA) return;
  alpha=norm(alpha); if(initialAlpha===null) initialAlpha=alpha;
  const heading=norm(initialAlpha-alpha);
  const compassLayer = markers[0];
  if(compassLayer) {
    const el = compassLayer.getElement();
    if(el) el.querySelector('svg').style.transform=`rotate(${heading}deg)`;
  }
}

/* ---------- Math ---------- */
function haversine(a,b,c,d){const R=6371e3,φ1=toRad(a),φ2=toRad(c),dφ=toRad(c-a),dλ=toRad(d-b);return R*2*Math.atan2(Math.sqrt(Math.sin(dφ/2)**2+Math.cos(φ1)*Math.cos(φ2)*Math.sin(dλ/2)**2),Math.sqrt(1-Math.sin(dφ/2)**2-Math.cos(φ1)*Math.cos(φ2)*Math.sin(dλ/2)**2));}
function bearing(a,b,c,d){const y=Math.sin(toRad(d-b))*Math.cos(toRad(c)),x=Math.cos(toRad(a))*Math.sin(toRad(c))-Math.sin(toRad(a))*Math.cos(toRad(c))*Math.cos(toRad(d-b));return norm(Math.atan2(y,x)*180/Math.PI); }
