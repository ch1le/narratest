/* App.js: Mobile Orientation HUD – add quaternary expansions */

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
const QUATERNARY_COLOR = "#00008B"; // dark blue
const COMPASS_COLOR = "#0066ff";
const ALL_COLOR = "#888";

/* ---------- State ---------- */
let DATA = null,
    map,
    userLat,
    userLon,
    initialAlpha = null;
let liveTargets = [], liveMarkers = [],
    tertiaryTargets = [], tertiaryMarkers = [],
    quaternaryTargets = [], quaternaryMarkers = [],
    allMarkers = [], currentLabel = "";
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
  buildMap(); addCompassMarker(); setupAllMarkers(); introVisuals(); pickTargets();
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
  compassMarker = L.marker([userLat, userLon], {icon: L.divIcon({ html, className:'', iconSize:[28,28], iconAnchor:[14,14] })}).addTo(map);
}

/* ---------- Intro Visuals ---------- */
function introVisuals() {
  loader.style.display = 'none'; bookmark.style.display = 'inline-block'; bookmark.style.opacity = '1';
}

/* ---------- All Markers & Reveal ---------- */
function setupAllMarkers() {
  allMarkers = DATA.targets.map(t => L.circleMarker([t.lat, t.lon], {radius:6, color:ALL_COLOR, weight:1, fillOpacity:1}));
  const btn = document.createElement('button'); btn.textContent='Reveal';
  Object.assign(btn.style,{position:'fixed',bottom:'16px',left:'16px',padding:'8px 12px',background:'red',color:'#fff',border:'none',borderRadius:'4px',zIndex:30,cursor:'pointer'});
  document.body.appendChild(btn);
  btn.addEventListener('click',()=>{ revealingAll=!revealingAll; allMarkers.forEach(m=>revealingAll?m.addTo(map):m.remove()); btn.textContent=revealingAll?'Hide':'Reveal'; });
}

/* ---------- Randomize Location ---------- */
(function(){ const btn=document.createElement('button'); btn.textContent='Randomize'; Object.assign(btn.style,{position:'fixed',bottom:'16px',right:'16px',padding:'8px 12px',background:'red',color:'#fff',border:'none',borderRadius:'4px',zIndex:30,cursor:'pointer'}); document.body.appendChild(btn); btn.addEventListener('click',()=>{ const R=6371e3,d=Math.random()*1000,brng=Math.random()*2*Math.PI; const lat1=toRad(58.377679),lon1=toRad(26.717398); const lat2=Math.asin(Math.sin(lat1)*Math.cos(d/R)+Math.cos(lat1)*Math.sin(d/R)*Math.cos(brng)); const lon2=lon1+Math.atan2(Math.sin(brng)*Math.sin(d/R)*Math.cos(lat1),Math.cos(d/R)-Math.sin(lat1)*Math.sin(lat2)); userLat=lat2*180/Math.PI;userLon=lon2*180/Math.PI; compassMarker.setLatLng([userLat,userLon]); map.setView([userLat,userLon],14); pickTargets(); }); })();

/* ---------- Pick Targets (Tags Filtered) ---------- */
function pickTargets() {
  liveMarkers.forEach(m=>m.remove()); liveMarkers=[];
  tertiaryMarkers.forEach(m=>m.remove()); tertiaryMarkers=[];
  quaternaryMarkers.forEach(m=>m.remove()); quaternaryMarkers=[];
  const selTags = Array.from(document.querySelectorAll('.tag')).filter(el=>!el.classList.contains('deselected')).map(el=>el.dataset.tag);
  const candidates = DATA.targets.filter(t=>selTags.includes(t.tag)); if(!candidates.length) return;
  const list = candidates.map(t=>({...t,dist:haversine(userLat,userLon,t.lat,t.lon),bear:bearing(userLat,userLon,t.lat,t.lon)})).sort((a,b)=>a.dist-b.dist);
  const first=list[0], spokes=[norm(first.bear+SPOKE_ANGLE),norm(first.bear-SPOKE_ANGLE)];
  const pickSpoke=dir=>list.filter(x=>Math.abs(shortest(dir,x.bear))<SPOKE_TOL).sort((a,b)=>a.dist-b.dist)[0];
  liveTargets=[first,pickSpoke(spokes[0]),pickSpoke(spokes[1])].filter(Boolean);
  liveMarkers=liveTargets.map(t=>L.circleMarker([t.lat,t.lon],{radius:6,color:TARGET_COLOR,weight:1,fillOpacity:1}).addTo(map).on('click',()=>handleMarkerClick(t)));
  map.fitBounds(L.featureGroup(liveMarkers).getBounds().pad(0.125)); showTarget(first);
}

/* ---------- Marker Click: Primary, Secondary, Tertiary ---------- */
function handleMarkerClick(t) {
  // primary
  if(t===liveTargets[0]) return showTarget(t);
  // secondary
  if(liveTargets.includes(t)) {
    // compute tertiary
    tertiaryTargets = DATA.targets.filter(x=>x.name!==liveTargets[0].name && x.name!==t.name)
      .map(x=>({...x,dist:haversine(t.lat,t.lon,x.lat,x.lon)})).sort((a,b)=>a.dist-b.dist).slice(0,2);
    tertiaryMarkers.forEach(m=>m.remove()); tertiaryMarkers=[];
    tertiaryMarkers=tertiaryTargets.map(x=>L.circleMarker([x.lat,x.lon],{radius:6,color:TERTIARY_COLOR,weight:1,fillOpacity:1}).addTo(map).on('click',()=>handleTertiaryClick(t,x)));
    return showTarget(t);
  }
}

/* ---------- Tertiary Click: Show Quaternary ---------- */
function handleTertiaryClick(parent, t) {
  // compute quaternary
  quaternaryTargets = DATA.targets
    .filter(x => x.name !== liveTargets[0].name && x.name !== parent.name && x.name !== t.name)
    .map(x => ({ ...x, dist: haversine(t.lat, t.lon, x.lat, x.lon) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 2);
  // clear old markers
  quaternaryMarkers.forEach(m => m.remove());
  quaternaryMarkers = [];
  // draw new quaternary markers
  quaternaryMarkers = quaternaryTargets.map(x =>
    L.circleMarker([x.lat, x.lon], { radius: 6, color: QUATERNARY_COLOR, weight: 1, fillOpacity: 1 })
      .addTo(map)
      .on('click', () => handleMarkerClick(x))
  );

  // clear description and build new layout
  descBox.innerHTML = '';

  // Secondary header row with collapse toggle
  const secHeader = document.createElement('div');
  // Secondary tag visible when collapsed
  const secTag = document.createElement('span');
  secTag.className = 'tag';
  secTag.textContent = parent.tag;
  secHeader.appendChild(secTag);
  Object.assign(secHeader.style, { display: 'flex', alignItems: 'center', gap: '8px' });
  const secTitle = document.createElement('div');
  secTitle.textContent = parent.name;
  Object.assign(secTitle.style, { fontSize: '20pt', fontWeight: '500' });
  secHeader.appendChild(secTitle);
  const secCollapse = document.createElement('button');
  secCollapse.textContent = '▾';
  Object.assign(secCollapse.style, { marginLeft: 'auto', background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer' });
  secHeader.appendChild(secCollapse);
  descBox.appendChild(secHeader);

  // Secondary description (collapsed by default)
  const secDesc = document.createElement('div');
  secDesc.textContent = parent.desc;
  Object.assign(secDesc.style, { marginTop: '4px', display: 'none' });
  descBox.appendChild(secDesc);

  // Collapse logic for secondary description
  secCollapse.addEventListener('click', () => {
    const hidden = secDesc.style.display === 'none';
    secDesc.style.display = hidden ? 'block' : 'none';
    secCollapse.textContent = hidden ? '▾' : '▴';
  });

  // Separator line
  const separator = document.createElement('hr');
  Object.assign(separator.style, { border: 'none', borderTop: '1px solid #ccc', margin: '8px 0' });
  descBox.appendChild(separator);

  // Tertiary header row with collapse button
  const terHeader = document.createElement('div');
  Object.assign(terHeader.style, { display: 'flex', alignItems: 'center', gap: '8px' });

  const terTitle = document.createElement('div');
  terTitle.textContent = t.name;
  Object.assign(terTitle.style, { fontSize: '18pt', fontWeight: '500' });
  terHeader.appendChild(terTitle);

  const collapseBtn = document.createElement('button');
  collapseBtn.textContent = '▾';
  Object.assign(collapseBtn.style, { marginLeft: 'auto', background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer' });
  terHeader.appendChild(collapseBtn);

  descBox.appendChild(terHeader);

  // Tertiary description (uncollapsed by default)
  const terDesc = document.createElement('div');
  terDesc.textContent = t.desc;
  Object.assign(terDesc.style, { marginTop: '4px' });
  descBox.appendChild(terDesc);
  descBox.style.opacity = '1';

  // Collapse logic for tertiary description
  collapseBtn.addEventListener('click', () => {
    const hidden = terDesc.style.display === 'none';
    terDesc.style.display = hidden ? 'block' : 'none';
    collapseBtn.textContent = hidden ? '▾' : '▴';
  });

  // draw route through secondary to tertiary
  if (routeControl) {
    routeControl.setWaypoints([[userLat, userLon], [parent.lat, parent.lon], [t.lat, t.lon]]);
  } else {
    routeControl = L.Routing.control({
      router: L.Routing.osrmv1({ serviceUrl: 'https://router.project-osrm.org/route/v1' }),
      waypoints: [[userLat, userLon], [parent.lat, parent.lon], [t.lat, t.lon]],
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

/* ---------- Show Target (Primary & Secondary) ---------- */
function showTarget(t) {
  descBox.innerHTML=''; currentLabel=t.name;
  // header row
  const header=document.createElement('div');Object.assign(header.style,{display:'flex',alignItems:'center',gap:'8px'});
  const bm=bookmark.cloneNode(true);bm.style.display='inline-block';header.appendChild(bm);
  const titleEl=document.createElement('div');titleEl.textContent=t.name;Object.assign(titleEl.style,{fontSize:'20pt',fontWeight:'500',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'});header.appendChild(titleEl);
  const collapse=document.createElement('button');collapse.textContent='▾';Object.assign(collapse.style,{marginLeft:'auto',background:'none',border:'none',fontSize:'18px',cursor:'pointer'});header.appendChild(collapse);descBox.appendChild(header);
  // tag & desc
  const tagEl=document.createElement('span');tagEl.className='tag';tagEl.textContent=t.tag;descBox.appendChild(tagEl);
  const descEl=document.createElement('div');descEl.textContent=t.desc;descEl.style.marginTop='8px';descBox.appendChild(descEl);
  descBox.style.opacity='1';
  collapse.addEventListener('click',()=>{const hid=descEl.style.display==='none';descEl.style.display=hid?'block':'none';tagEl.style.display=hid?'inline':'none';collapse.textContent=hid?'▾':'▴'});
  // bounce
  liveMarkers.forEach(m=>{const el=m.getElement();if(el)el.classList.remove('active-marker')});const act=liveMarkers.find(m=>{const p=m.getLatLng();return p.lat===t.lat&&p.lng===t.lon});if(act){const el=act.getElement();if(el)el.classList.add('active-marker')}
  // route
  if(routeControl)routeControl.setWaypoints([[userLat,userLon],[t.lat,t.lon]]);
  else routeControl=L.Routing.control({router:L.Routing.osrmv1({serviceUrl:'https://router.project-osrm.org/route/v1'}),waypoints:[[userLat,userLon],[t.lat,t.lon]],lineOptions:{styles:[{color:'#000',weight:3}]},createMarker:()=>null,addWaypoints:false,draggableWaypoints:false,fitSelectedRoutes:false,showAlternatives:false,show:false}).addTo(map),document.querySelectorAll('.leaflet-routing-container').forEach(el=>el.style.display='none');
}

/* ---------- Orientation ---------- */
function handleOrientation({alpha=0}){if(!DATA)return;alpha=norm(alpha);if(initialAlpha===null)initialAlpha=alpha;const heading=norm(initialAlpha-alpha),svg=compassMarker.getElement().querySelector('svg');svg.style.transform=`rotate(${heading}deg)`;liveTargets.forEach(t=>{if(Math.abs(shortest(heading,t.bear))<VIEW_TOL&&currentLabel!==t.name)showTarget(t)})}

/* ---------- Math ---------- */
function haversine(a,b,c,d){const R=6371e3,φ1=toRad(a),φ2=toRad(c),dφ=toRad(c-a),dλ=toRad(d-b);const A=Math.sin(dφ/2)**2+Math.cos(φ1)*Math.cos(φ2)*Math.sin(dλ/2)**2;return R*2*Math.atan2(Math.sqrt(A),Math.sqrt(1-A))}
function bearing(a,b,c,d){const y=Math.sin(toRad(d-b))*Math.cos(toRad(c)),x=Math.cos(toRad(a))*Math.sin(toRad(c))-Math.sin(toRad(a))*Math.cos(toRad(c))*Math.cos(toRad(d-b));return norm(Math.atan2(y,x)*180/Math.PI); }
