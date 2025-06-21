/* App.js: Mobile Orientation HUD – final version
 * • Full-width Leaflet map
 * • Compass marker
 * • Randomize location & Reveal All buttons
 * • Three "Y"-pattern targets with bounce animation
 * • Title, tag, description below map
 * • Bookmark icon and collapse button in title row
 */

/* ---------- Helpers ---------- */
const $        = sel => document.querySelector(sel);
const norm     = d   => (d % 360 + 360) % 360;
const toRad    = d   => d * Math.PI / 180;
const shortest = (a,b) => ((a - b + 540) % 360) - 180;

/* ---------- DOM Refs ---------- */
const enableBtn      = $("#enable");
const permissionBox  = $("#permissionBox");
const permissionText = $("#permissionText");
const selectorRow    = $("#selectorRow");
const descBox        = $("#descBox");
const bookmark       = $("#bookmark");
const loader         = $("#loader");

/* ---------- Constants ---------- */
const VIEW_TOL      = 20;
const SPOKE_TOL     = 25;
const SPOKE_ANGLE   = 120;
const TARGET_COLOR  = "#000";
const COMPASS_COLOR = "#0066ff";
const ALL_COLOR     = "#888";

/* ---------- State ---------- */
let DATA = null, map, userLat, userLon, initialAlpha = null;
let liveTargets=[], liveMarkers=[], allMarkers=[], currentLabel="";
let compassMarker=null, routeControl=null, revealingAll=false;

/* ---------- Load content & Mock location ---------- */
Promise.all([
  fetch("content.json").then(r=>r.json()),
  new Promise(res=>{
    const USE_MOCK=true;
    if(USE_MOCK){ userLat=58.377679; userLon=26.717398; res(); }
    else navigator.geolocation.getCurrentPosition(
      ({coords})=>{userLat=coords.latitude;userLon=coords.longitude;res();},
      err=>alert(err.message)
    );
  })
]).then(([json])=>{
  DATA=json;
  permissionText.textContent=json.permissionMessage.replace(/\n/g,'\n');
});

/* ---------- Tag Selector Toggle ---------- */
selectorRow.addEventListener("click",e=>{
  if(e.target.classList.contains("tag"))
    e.target.classList.toggle("deselected");
});

/* ---------- Permission & Start ---------- */
enableBtn.addEventListener("click",startPresent);
function startPresent(){
  permissionBox.remove();
  buildMap();
  addCompassMarker();
  setupAllMarkers();
  introVisuals();
  pickTargets();
  window.addEventListener("deviceorientation",handleOrientation);
}

/* ---------- Map Setup ---------- */
function buildMap(){
  map=L.map("map",{zoomControl:false,attributionControl:false})
    .setView([userLat,userLon],14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {maxZoom:19}).addTo(map);
}

/* ---------- Compass Marker ---------- */
function addCompassMarker(){
  const html=`<div class='compass-icon'>
    <svg width='28' height='28' viewBox='0 0 28 28'>
      <polygon points='14,3 18,19 14,15 10,19' fill='${COMPASS_COLOR}'/>
    </svg></div>`;
  compassMarker=L.marker([userLat,userLon],{
    icon:L.divIcon({html, className:'', iconSize:[28,28], iconAnchor:[14,14]})
  }).addTo(map);
}

/* ---------- Intro Visuals ---------- */
function introVisuals(){
  loader.style.display='none';
  bookmark.style.display='inline-block';
  bookmark.style.opacity='1';
}

/* ---------- All Markers & Reveal ---------- */
function setupAllMarkers(){
  allMarkers=DATA.targets.map(t=>L.circleMarker([t.lat,t.lon],{
    radius:6,color:ALL_COLOR,weight:1,fillOpacity:1
  }));
  const btn=document.createElement('button');
  btn.textContent='Reveal';
  Object.assign(btn.style,{position:'fixed',bottom:'16px',left:'16px',
    padding:'8px 12px',background:'red',color:'#fff',border:'none',borderRadius:'4px',zIndex:30,cursor:'pointer'});
  document.body.appendChild(btn);
  btn.addEventListener('click',()=>{
    revealingAll=!revealingAll;
    if(revealingAll){ allMarkers.forEach(m=>m.addTo(map)); btn.textContent='Hide'; }
    else { allMarkers.forEach(m=>m.remove()); btn.textContent='Reveal'; }
  });
}

/* ---------- Randomize Mock Location ---------- */
(function(){
  const btn=document.createElement('button');
  btn.textContent='Randomize';
  Object.assign(btn.style,{position:'fixed',bottom:'16px',right:'16px',
    padding:'8px 12px',background:'red',color:'#fff',border:'none',borderRadius:'4px',zIndex:30,cursor:'pointer'});
  document.body.appendChild(btn);
  btn.addEventListener('click',()=>{
    const R=6371e3, d=Math.random()*1000, brng=Math.random()*2*Math.PI;
    const lat1=toRad(58.377679), lon1=toRad(26.717398);
    const lat2=Math.asin(Math.sin(lat1)*Math.cos(d/R)+Math.cos(lat1)*Math.sin(d/R)*Math.cos(brng));
    const lon2=lon1+Math.atan2(Math.sin(brng)*Math.sin(d/R)*Math.cos(lat1),Math.cos(d/R)-Math.sin(lat1)*Math.sin(lat2));
    userLat=lat2*180/Math.PI;userLon=lon2*180/Math.PI;
    compassMarker.setLatLng([userLat,userLon]);map.setView([userLat,userLon]);pickTargets();
  });
})();

/* ---------- Pick Targets ---------- */
function pickTargets(){
  liveMarkers.forEach(m=>m.remove()); liveMarkers=[];
  const list=DATA.targets.map(t=>({
    ...t, dist:haversine(userLat,userLon,t.lat,t.lon),
    bear:bearing(userLat,userLon,t.lat,t.lon)
  })).sort((a,b)=>a.dist-b.dist);
  const first=list[0], spokes=[norm(first.bear+SPOKE_ANGLE),norm(first.bear-SPOKE_ANGLE)];
  const pickSpoke=dir=>list.filter(t=>Math.abs(shortest(dir,t.bear))<SPOKE_TOL)
    .sort((a,b)=>a.dist-b.dist)[0];
  liveTargets=[first,pickSpoke(spokes[0]),pickSpoke(spokes[1])].filter(Boolean);
  liveMarkers=liveTargets.map(t=>L.circleMarker([t.lat,t.lon],{
    radius:6,color:TARGET_COLOR,weight:1,fillOpacity:1
  }).addTo(map).on('click',()=>showTarget(t)) );
  map.fitBounds(L.featureGroup(liveMarkers).getBounds().pad(0.125));
  showTarget(first);
}

/* ---------- Show Target ---------- */
function showTarget(t){
  // Title row with bookmark & collapse
  descBox.innerHTML='';
  const header=document.createElement('div');
  Object.assign(header.style,{display:'flex',alignItems:'center',gap:'8px'});
  const bm=bookmark.cloneNode(true);bm.style.display='inline-block';header.appendChild(bm);
  const titleEl=document.createElement('div');titleEl.textContent=t.name;
  Object.assign(titleEl.style,{fontSize:'20pt',fontWeight:'500',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'});
  header.appendChild(titleEl);
  const collapse=document.createElement('button');collapse.textContent='▾';
  Object.assign(collapse.style,{marginLeft:'auto',background:'none',border:'none',fontSize:'18px',cursor:'pointer'});
  header.appendChild(collapse);
  descBox.appendChild(header);

  // Tag
  const tagEl=document.createElement('span');tagEl.className='tag';tagEl.textContent=t.tag;descBox.appendChild(tagEl);

  // Description
  const descEl=document.createElement('div');descEl.textContent=t.desc;
  descEl.style.marginTop='8px';descBox.appendChild(descEl);
  descBox.style.opacity='1';

  // Collapse behavior
  collapse.addEventListener('click',()=>{
    const hidden=descEl.style.display==='none';
    descEl.style.display=hidden?'block':'none';tagEl.style.display=hidden?'inline-block':'none';
    collapse.textContent=hidden?'▾':'▴';
  });

  // Bounce active marker
  liveMarkers.forEach(m=>{const el=m.getElement();if(el)el.classList.remove('active-marker');});
  const active=liveMarkers.find(m=>{const p=m.getLatLng();return p.lat===t.lat&&p.lng===t.lon;});
  if(active){const el=active.getElement();if(el)el.classList.add('active-marker');}

  // Routing
  if(routeControl)routeControl.setWaypoints([[userLat,userLon],[t.lat,t.lon]]);
  else{routeControl=L.Routing.control({waypoints:[[userLat,userLon],[t.lat,t.lon]],
      lineOptions:{styles:[{color:'#000',weight:3}]},createMarker:()=>null,
      addWaypoints:false,draggableWaypoints:false,fitSelectedRoutes:false,
      showAlternatives:false,show:false}).addTo(map);
    document.querySelectorAll('.leaflet-routing-container').forEach(el=>el.style.display='none');}
}

/* ---------- Orientation Handler ---------- */
function handleOrientation({alpha=0}){
  if(!DATA)return;alpha=norm(alpha);if(initialAlpha===null)initialAlpha=alpha;
  const heading=norm(initialAlpha-alpha),svg=compassMarker.getElement().querySelector('svg');
  svg.style.transform=`rotate(${heading}deg)`;
  liveTargets.forEach(t=>{if(Math.abs(shortest(heading,t.bear))<VIEW_TOL&&currentLabel!==t.name)showTarget(t);});
}

/* ---------- Math ---------- */
function haversine(a,b,c,d){return (function(R,φ1,φ2,dφ,dλ){const a=Math.sin(dφ/2)**2+Math.cos(φ1)*Math.cos(φ2)*Math.sin(dλ/2)**2;return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));})(6371e3,toRad(a),toRad(c),toRad(c-a),toRad(d-b));}
function bearing(a,b,c,d){return (function(y,x){return norm(Math.atan2(y,x)*180/Math.PI);})(Math.sin(toRad(d-b))*Math.cos(toRad(c)),Math.cos(toRad(a))*Math.sin(toRad(c))-Math.sin(toRad(a))*Math.cos(toRad(c))*Math.cos(toRad(d-b)));}
