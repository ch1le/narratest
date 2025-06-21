/* App.js: Mobile Orientation HUD – full version with deep chaining */

/* ---------- Helpers ---------- */
const $ = sel => document.querySelector(sel);
const norm = d => (d % 360 + 360) % 360;
const toRad = d => d * Math.PI / 180;
const shortest = (a, b) => ((a - b + 540) % 360) - 180;

/* ---------- DOM Refs ---------- */
const enableBtn = $("#enable");
const permissionBox = $("#permissionBox");
const permissionText = $("#permissionText");
const selectorRow = $("#selectorRow");
const descBox = $("#descBox");
const bookmark = $("#bookmark");
const loader = $("#loader");

/* ---------- Constants ---------- */
const VIEW_TOL = 20;
const SPOKE_TOL = 25;
const SPOKE_ANGLE = 120;
const TARGET_COLOR = "#000";
const TERTIARY_COLOR = "#006400";
const QUATERNARY_COLOR = "#00008B";
const COMPASS_COLOR = "#0066ff";
const ALL_COLOR = "#888";

/* ---------- State ---------- */
let DATA = null,
    map,
    userLat,
    userLon,
    initialAlpha = null;
let liveTargets = [], liveMarkers = [];
let tertiaryTargets = [], tertiaryMarkers = [];
let quaternaryTargets = [], quaternaryMarkers = [];
let allMarkers = [], currentLabel = "";
let compassMarker = null, routeControl = null, revealingAll = false;

/* ---------- Load content + Mock location ---------- */
Promise.all([
  fetch("content.json").then(r => r.json()),
  new Promise(res => {
    const USE_MOCK = true;
    if (USE_MOCK) {
      userLat = 58.377679; userLon = 26.717398; res();
    } else {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => { userLat = coords.latitude; userLon = coords.longitude; res(); },
        err => alert(err.message)
      );
    }
  })
]).then(([json]) => {
  DATA = json;
  permissionText.textContent = json.permissionMessage.replace(/\n/g, '\n');
});

/* ---------- Tag Selector ---------- */
selectorRow.addEventListener("click", e => {
  if (e.target.classList.contains("tag")) {
    e.target.classList.toggle("deselected");
    if (map) pickTargets();
  }
});

/* ---------- Permission & Start ---------- */
enableBtn.addEventListener("click", startPresent);
function startPresent() {
  const hb = document.getElementById('headerBar'); if (hb) hb.remove();
  permissionBox.remove();
  buildMap();
  addCompassMarker();
  setupAllMarkers();
  introVisuals();
  pickTargets();
  window.addEventListener("deviceorientation", handleOrientation);
}

/* ---------- Map Setup ---------- */
function buildMap() {
  map = L.map("map", { zoomControl: false, attributionControl: false })
    .setView([userLat, userLon], 14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
}

/* ---------- Compass Marker ---------- */
function addCompassMarker() {
  const html = `<div class='compass-icon'><svg width='28' height='28'><polygon points='14,3 18,19 14,15 10,19' fill='${COMPASS_COLOR}'/></svg></div>`;
  compassMarker = L.marker([userLat, userLon], {
    icon: L.divIcon({ html, className: '', iconSize: [28,28], iconAnchor: [14,14] })
  }).addTo(map);
}

/* ---------- Intro Visuals ---------- */
function introVisuals() {
  loader.style.display = 'none';
  bookmark.style.display = 'inline-block';
  bookmark.style.opacity = '1';
}

/* ---------- All Markers & Reveal ---------- */
function setupAllMarkers() {
  allMarkers = DATA.targets.map(t =>
    L.circleMarker([t.lat, t.lon], { radius:6, color:ALL_COLOR, weight:1, fillOpacity:1 })
  );
  const btn = document.createElement('button');
  btn.textContent = 'Reveal';
  Object.assign(btn.style, {
    position:'fixed', bottom:'16px', left:'16px', padding:'8px 12px',
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
(function() {
  const btn = document.createElement('button');
  btn.textContent = 'Randomize';
  Object.assign(btn.style, {
    position:'fixed', bottom:'16px', right:'16px', padding:'8px 12px',
    background:'red', color:'#fff', border:'none', borderRadius:'4px', zIndex:30, cursor:'pointer'
  });
  document.body.appendChild(btn);
  btn.addEventListener('click', () => {
    const R = 6371e3, d = Math.random() * 1000, brng = Math.random() * 2 * Math.PI;
    const lat1 = toRad(58.377679), lon1 = toRad(26.717398);
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d/R) + Math.cos(lat1) * Math.sin(d/R) * Math.cos(brng));
    const lon2 = lon1 + Math.atan2(
      Math.sin(brng) * Math.sin(d/R) * Math.cos(lat1),
      Math.cos(d/R) - Math.sin(lat1) * Math.sin(lat2)
    );
    userLat = lat2 * 180 / Math.PI;
    userLon = lon2 * 180 / Math.PI;
    compassMarker.setLatLng([userLat, userLon]);
    map.setView([userLat, userLon], 14);
    pickTargets();
  });
})();

/* ---------- Pick Targets (Tags Filtered) ---------- */
function pickTargets() {
  liveMarkers.forEach(m => m.remove()); liveMarkers = [];
  tertiaryMarkers.forEach(m => m.remove()); tertiaryMarkers = [];
  quaternaryMarkers.forEach(m => m.remove()); quaternaryMarkers = [];
  const selTags = Array.from(document.querySelectorAll('.tag'))
    .filter(el => !el.classList.contains('deselected'))
    .map(el => el.dataset.tag);
  const candidates = DATA.targets.filter(t => selTags.includes(t.tag));
  if (!candidates.length) return;
  const list = candidates.map(t => ({
    ...t,
    dist: haversine(userLat, userLon, t.lat, t.lon),
    bear: bearing(userLat, userLon, t.lat, t.lon)
  })).sort((a,b) => a.dist - b.dist);
  const first = list[0];
  const spokes = [norm(first.bear + SPOKE_ANGLE), norm(first.bear - SPOKE_ANGLE)];
  const pickSpoke = dir => list.filter(x => Math.abs(shortest(dir, x.bear)) < SPOKE_TOL)
                                .sort((a,b) => a.dist - b.dist)[0];
  liveTargets = [first, pickSpoke(spokes[0]), pickSpoke(spokes[1])].filter(Boolean);
  liveMarkers = liveTargets.map(t =>
    L.circleMarker([t.lat, t.lon], { radius:6, color:TARGET_COLOR, weight:1, fillOpacity:1 })
      .addTo(map)
      .on('click', () => handleMarkerClick(t))
  );
  map.fitBounds(L.featureGroup(liveMarkers).getBounds().pad(0.125));
  showTarget(first);
}

/* ---------- Handle Marker Click: Deep Expansion ---------- */
function handleMarkerClick(t) {
  // primary
  if (t === liveTargets[0]) return showTarget(t);

  // secondary
  if (liveTargets.includes(t)) {
    // compute tertiary
    tertiaryTargets = DATA.targets
      .filter(x => x.name !== liveTargets[0].name && x.name !== t.name)
      .map(x => ({ ...x, dist: haversine(t.lat, t.lon, x.lat, x.lon) }))
      .sort((a,b) => a.dist - b.dist)
      .slice(0,2);
    tertiaryMarkers.forEach(m => m.remove()); tertiaryMarkers = [];
    tertiaryMarkers = tertiaryTargets.map(x =>
      L.circleMarker([x.lat, x.lon], { radius:6, color:TERTIARY_COLOR, weight:1, fillOpacity:1 })
        .addTo(map)
        .on('click', () => handleTertiaryClick(t, x))
    );
    return showTarget(t);
  }

  // tertiary
  const terIndex = tertiaryTargets.findIndex(x => x.name === t.name);
  if (terIndex > -1) {
    handleTertiaryClick(liveTargets[1], t);
    return;
  }

  // beyond tertiary, treat like tertiary: pivot on t
  // compute next two deeper
  const pivot = t;
  const exclude = [liveTargets[0].name];
  if (liveTargets.includes(t)) exclude.push(t.name);
  tertiaryTargets = DATA.targets.filter(x => !exclude.includes(x.name))
    .map(x => ({ ...x, dist: haversine(pivot.lat, pivot.lon, x.lat, x.lon) }))
    .sort((a,b) => a.dist - b.dist)
    .slice(0,2);
  tertiaryMarkers.forEach(m => m.remove()); tertiaryMarkers = [];
  tertiaryMarkers = tertiaryTargets.map(x =>
    L.circleMarker([x.lat, x.lon], { radius:6, color:TERTIARY_COLOR, weight:1, fillOpacity:1 })
      .addTo(map)
      .on('click', () => handleMarkerClick(x))
  );
  showTarget(t);
}

/* ---------- Tertiary Click: Show Quaternary ---------- */
function handleTertiaryClick(parentSecondary, parentTertiary) {
  // compute quaternary candidates
  quaternaryTargets = DATA.targets
    .filter(x => x.name !== liveTargets[0].name && x.name !== parentSecondary.name && x.name !== parentTertiary.name)
    .map(x => ({ ...x, dist: haversine(parentTertiary.lat, parentTertiary.lon, x.lat, x.lon) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 2);

  // draw quaternary markers
  quaternaryMarkers.forEach(m => m.remove());
  quaternaryMarkers = quaternaryTargets.map(q =>
    L.circleMarker([q.lat, q.lon], { radius: 6, color: QUATERNARY_COLOR, weight: 1, fillOpacity: 1 })
      .addTo(map)
      .on("click", () => handleQuaternaryClick(parentSecondary, parentTertiary, q))
  );

  // temporarily show chain of secondary + tertiary
  showLockedChain([parentSecondary, parentTertiary]);
}

/* ---------- New: Quaternary Click: Full 3-level Chain ---------- */
function handleQuaternaryClick(sec, ter, qua) {
  descBox.innerHTML = "";
  
  // helper to render each level
  function renderLevel(item, size, collapsed) {
    // header row
    const row = document.createElement("div");
    Object.assign(row.style, { display: "flex", alignItems: "center", gap: "8px" });
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = item.tag;
    row.appendChild(tag);
    const title = document.createElement("div");
    title.textContent = item.name;
    Object.assign(title.style, { fontSize: size, fontWeight: "500" });
    row.appendChild(title);
    let desc;
    if (collapsed || item === qua) {
      const btn = document.createElement("button");
      btn.textContent = collapsed ? "▾" : "";
      Object.assign(btn.style, { marginLeft: "auto", background: "none", border: "none", fontSize: "18px", cursor: "pointer" });
      row.appendChild(btn);
      desc = document.createElement("div");
      desc.textContent = item.desc;
      Object.assign(desc.style, { marginTop: "4px", display: collapsed ? "none" : "block" });
      btn.addEventListener("click", () => {
        const hidden = desc.style.display === "none";
        desc.style.display = hidden ? "block" : "none";
        btn.textContent = hidden ? "▾" : "▴";
      });
    } else {
      desc = document.createElement("div");
      desc.textContent = item.desc;
      Object.assign(desc.style, { marginTop: "4px" });
    }
    descBox.appendChild(row);
    if (desc) descBox.appendChild(desc);
    const hr = document.createElement("hr");
    Object.assign(hr.style, { border: "none", borderTop: "1px solid #ccc", margin: "8px 0" });
    descBox.appendChild(hr);
  }

  // render secondary (collapsed)
  renderLevel(sec, "20pt", true);
  // render tertiary (collapsed)
  renderLevel(ter, "18pt", true);
  // render quaternary (expanded)
  renderLevel(qua, "16pt", false);

  // route through all four
  const waypoints = [
    [userLat, userLon],
    [sec.lat, sec.lon],
    [ter.lat, ter.lon],
    [qua.lat, qua.lon]
  ];
  if (routeControl) {
    routeControl.setWaypoints(waypoints);
  }
  else {
    routeControl = L.Routing.control({
      router: L.Routing.osrmv1({ serviceUrl: 'https://router.project-osrm.org/route/v1' }),
      waypoints: waypoints,
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

/* ---------- Show Target (Primary/Secondary) ---------- */
function showTarget(t) {
  descBox.innerHTML=''; currentLabel=t.name;
  const header = document.createElement('div'); Object.assign(header.style,{display:'flex',alignItems:'center',gap:'8px'});
  const bm2 = bookmark.cloneNode(true); bm2.style.display='inline-block'; header.appendChild(bm2);
  const title2 = document.createElement('div'); title2.textContent=t.name;
  Object.assign(title2.style,{fontSize:'20pt',fontWeight:'500',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'});
  header.appendChild(title2);
  const coll = document.createElement('button'); coll.textContent='▾'; Object.assign(coll.style,{marginLeft:'auto',background:'none',border:'none',fontSize:'18px',cursor:'pointer'});
  header.appendChild(coll); descBox.appendChild(header);

  const tag2 = document.createElement('span'); tag2.className='tag'; tag2.textContent=t.tag; descBox.appendChild(tag2);
  const d2 = document.createElement('div'); d2.textContent=t.desc; d2.style.marginTop='8px'; descBox.appendChild(d2);
  descBox.style.opacity='1';
  coll.addEventListener('click',()=>{ const h=d2.style.display==='none'; d2.style.display=h?'block':'none'; tag2.style.display=h?'inline':'none'; coll.textContent=h?'▾':'▴'; });

  liveMarkers.forEach(m=>{const el=m.getElement();if(el)el.classList.remove('active-marker')});
  const active = liveMarkers.find(m=>{const p=m.getLatLng();return p.lat===t.lat&&p.lng===t.lon});
  if(active){const el=active.getElement();if(el)el.classList.add('active-marker')}
  if(routeControl) routeControl.setWaypoints([[userLat,userLon],[t.lat,t.lon]]);
  else {
    routeControl = L.Routing.control({
      router: L.Routing.osrmv1({serviceUrl:'https://router.project-osrm.org/route/v1'}),
      waypoints:[[userLat,userLon],[t.lat,t.lon]],
      lineOptions:{styles:[{color:'#000',weight:3}]},
      createMarker:()=>null,addWaypoints:false,draggableWaypoints:false,fitSelectedRoutes:false,showAlternatives:false,show:false
    }).addTo(map);
    document.querySelectorAll('.leaflet-routing-container').forEach(el=>el.style.display='none');
  }
}

/* ---------- Orientation ---------- */
function handleOrientation({alpha=0}) {
  if(!DATA) return;
  alpha = norm(alpha);
  if(initialAlpha===null) initialAlpha=alpha;
  const heading = norm(initialAlpha - alpha);
  const svg = compassMarker.getElement().querySelector('svg');
  svg.style.transform = `rotate(${heading}deg)`;
  liveTargets.forEach(t=>{
    if(Math.abs(shortest(heading,t.bear))<VIEW_TOL && currentLabel!==t.name) showTarget(t);
  });
}

/* ---------- Math ---------- */
function haversine(a,b,c,d){const R=6371e3,φ1=toRad(a),φ2=toRad(c),dφ=toRad(c-a),dλ=toRad(d-b);const A=Math.sin(dφ/2)**2+Math.cos(φ1)*Math.cos(φ2)*Math.sin(dλ/2)**2;return R*2*Math.atan2(Math.sqrt(A),Math.sqrt(1-A))}
function bearing(a,b,c,d){const y=Math.sin(toRad(d-b))*Math.cos(toRad(c)),x=Math.cos(toRad(a))*Math.sin(toRad(c))-Math.sin(toRad(a))*Math.cos(toRad(c))*Math.cos(toRad(d-b));return norm(Math.atan2(y,x)*180/Math.PI)}
