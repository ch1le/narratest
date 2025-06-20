/* App.js: Mobile Orientation HUD – driving route with bounce, click activation, and propagated tags above description */

/* ---------- helpers ---------- */
const $        = sel => document.querySelector(sel);
const norm     = d   => (d % 360 + 360) % 360;
const toRad    = d   => d * Math.PI / 180;
const shortest = (a,b) => ((a - b + 540) % 360) - 180;

/* ---------- DOM refs ---------- */
const enableBtn      = $("#enable");
const permissionBox  = $("#permissionBox");
const permissionText = $("#permissionText");
const selectorRow    = $("#selectorRow");
const titleText      = $("#titleText");
const descBox        = $("#descBox");
const bookmark       = $("#bookmark");
const loader         = $("#loader");

/* ---------- constants ---------- */
const VIEW_TOL      = 20;
const SPOKE_TOL     = 25;
const SPOKE_ANGLE   = 120;
const TARGET_COLOR  = "#000";
const COMPASS_COLOR = "#0066ff";

/* ---------- state ---------- */
let DATA = null, map, userLat, userLon, initialAlpha = null;
let liveTargets = [], liveMarkers = [], currentLabel = "";
let compassMarker = null, routeControl = null;

/* ---------- load content + mock location ---------- */
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
  permissionText.textContent = json.permissionMessage.replace(/\n/g, "\n");
});

/* ---------- selector tags ---------- */
selectorRow.addEventListener("click", e => {
  if (e.target.classList.contains("tag")) e.target.classList.toggle("deselected");
});

/* ---------- permission ---------- */
enableBtn.addEventListener("click", startPresent);

function startPresent() {
  permissionBox.remove();
  buildMap();
  addCompassMarker();
  introVisuals();
  pickTargets();
  window.addEventListener("deviceorientation", handleOrientation);
}

function buildMap() {
  map = L.map("map", { zoomControl: false, attributionControl: false })
        .setView([userLat, userLon], 14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 })
    .addTo(map);
}

function addCompassMarker() {
  const html = `<div class=\"compass-icon\">` +
               `<svg width=\"28\" height=\"28\" viewBox=\"0 0 28 28\">` +
               `<polygon points=\"14,3 18,19 14,15 10,19\" fill=\"${COMPASS_COLOR}\"/>` +
               `</svg></div>`;
  compassMarker = L.marker([userLat,userLon],{
    icon: L.divIcon({ html, className: "", iconSize:[28,28], iconAnchor:[14,14] })
  }).addTo(map);
}

function introVisuals() {
  loader.style.display = "none";
  bookmark.style.display = "inline-block";
  bookmark.style.opacity = "1";
  titleText.style.opacity = "1";
}

function haversine(lat1,lon1,lat2,lon2) {
  const R=6371e3, φ1=toRad(lat1), φ2=toRad(lat2),
        dφ=toRad(lat2-lat1), dλ=toRad(lon2-lon1);
  const a = Math.sin(dφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(dλ/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function bearing(lat1,lon1,lat2,lon2) {
  const y=Math.sin(toRad(lon2-lon1))*Math.cos(toRad(lat2));
  const x=Math.cos(toRad(lat1))*Math.sin(toRad(lat2)) -
          Math.sin(toRad(lat1))*Math.cos(toRad(lat2))*Math.cos(toRad(lon2-lon1));
  return norm(Math.atan2(y,x)*180/Math.PI);
}

function pickTargets() {
  // remove previous markers
  if (liveMarkers.length) {
    liveMarkers.forEach(m => m.remove());
    liveMarkers = [];
  }

  const list = DATA.targets.map(t=>({
    ...t,
    dist: haversine(userLat,userLon,t.lat,t.lon),
    bear: bearing(userLat,userLon,t.lat,t.lon)
  })).sort((a,b)=>a.dist-b.dist);

  const first = list[0];
  const spokes=[norm(first.bear+SPOKE_ANGLE),norm(first.bear-SPOKE_ANGLE)];
  const pick=dir=>list.filter(t=>Math.abs(shortest(dir,t.bear))<SPOKE_TOL)
                     .sort((a,b)=>a.dist-b.dist)[0];
  const second=pick(spokes[0]), third=pick(spokes[1]);
  liveTargets=[first,second,third].filter(Boolean);

  liveMarkers = liveTargets.map(t=>
    L.circleMarker([t.lat,t.lon],{radius:6,color:TARGET_COLOR,weight:1,fillOpacity:1})
     .addTo(map)
     .on('click',()=>showTarget(t))
  );(t=>
    L.circleMarker([t.lat,t.lon],{radius:6,color:TARGET_COLOR,weight:1,fillOpacity:1})
     .addTo(map)
     .on('click',()=>showTarget(t))
  );

  map.fitBounds(L.featureGroup(liveMarkers).getBounds().pad(0.125));
  showTarget(first);
}

function showTarget(t) {
  // Hide the old header bar
  const headerBar = document.getElementById('headerBar');
  headerBar && headerBar.remove();

  // Rebuild descBox: title, tag, description
  descBox.innerHTML = '';

  // Title
  const titleEl = document.createElement('div');
  titleEl.id = 'descTitle';
  titleEl.textContent = t.name;
  titleEl.style.fontSize = '20pt';
  titleEl.style.fontWeight = '500';
  titleEl.style.whiteSpace = 'nowrap';
  titleEl.style.overflow = 'hidden';
  titleEl.style.textOverflow = 'ellipsis';
  descBox.appendChild(titleEl);

  // Tag below title
  const tagEl = document.createElement('span');
  tagEl.className = 'tag';
  tagEl.textContent = t.tag;
  tagEl.dataset.tag = t.tag;
  tagEl.style.display = 'inline-block';
  tagEl.style.margin = '4px 0';
  descBox.appendChild(tagEl);

  // Description text
  const descText = document.createElement('div');
  descText.textContent = t.desc;
  descText.style.marginTop = '8px';
  descBox.appendChild(descText);

  descBox.style.opacity = '1';
  currentLabel = t.name;

  // Bounce animation for active marker
  liveMarkers.forEach(m => {
    const el = m.getElement(); if (el) el.classList.remove('active-marker');
  });
  const active = liveMarkers.find(m => {
    const { lat, lng } = m.getLatLng(); return lat === t.lat && lng === t.lon;
  });
  if (active) {
    const el = active.getElement(); if (el) el.classList.add('active-marker');
  }

  // Update or create route
  if (routeControl) {
    routeControl.setWaypoints([[userLat,userLon],[t.lat,t.lon]]);
  } else {
    routeControl = L.Routing.control({
      waypoints: [[userLat,userLon],[t.lat,t.lon]],
      lineOptions: { styles: [{ color: '#000', weight: 3 }] },
      createMarker: () => null,
      addWaypoints: false,
      draggableWaypoints: false,
      fitSelectedRoutes: false,
      showAlternatives: false,
      show: false
    }).addTo(map);
    document.querySelectorAll('.leaflet-routing-container')
            .forEach(el => el.style.display = 'none');
  }
}
  tagEl.textContent = t.tag;
  tagEl.dataset.tag = t.tag;

  // rebuild description box with tag + text
  descBox.innerHTML = '';
  descBox.appendChild(tagEl);
  const descText = document.createElement('div');
  descText.textContent = t.desc;
  descBox.appendChild(descText);
  descBox.style.opacity = '1';
  currentLabel = t.name;

  // bounce animation
  liveMarkers.forEach(m=>{
    const el=m.getElement(); if(el)el.classList.remove('active-marker');
  });
  const active = liveMarkers.find(m=>{
    const {lat,lng}=m.getLatLng(); return lat===t.lat&&lng===t.lon;
  });
  if(active){ const el=active.getElement(); if(el)el.classList.add('active-marker'); }

  if(routeControl) {
    routeControl.setWaypoints([[userLat,userLon],[t.lat,t.lon]]);
  } else {
    routeControl=L.Routing.control({
      waypoints:[[userLat,userLon],[t.lat,t.lon]],
      lineOptions:{styles:[{color:'#000',weight:3}]},
      createMarker:()=>null,addWaypoints:false,draggableWaypoints:false,
      fitSelectedRoutes:false,showAlternatives:false,show:false
    }).addTo(map);
    document.querySelectorAll('.leaflet-routing-container')
            .forEach(el=>el.style.display='none');
  }
}

function handleOrientation({alpha=0}){
  if(!DATA)return; alpha=norm(alpha);
  if(initialAlpha===null)initialAlpha=alpha;
  const heading=norm(initialAlpha-alpha);
  const svg=compassMarker.getElement().querySelector('svg');
  svg.style.transform=`rotate(${heading}deg)`;
  liveTargets.forEach(t=>{
    if(Math.abs(shortest(heading,t.bear))<VIEW_TOL&&currentLabel!==t.name)
      showTarget(t);
  });
}

// Randomize Location Button
const randomBtn=document.createElement('button');
randomBtn.textContent='Randomize Location';
Object.assign(randomBtn.style,{position:'fixed',bottom:'16px',right:'16px',
  padding:'10px 14px',background:'red',color:'#fff',border:'none',borderRadius:'4px',
  zIndex:30,cursor:'pointer'});
document.body.appendChild(randomBtn);
randomBtn.addEventListener('click',()=>{
  const R=6371e3, maxD=1000, d=Math.random()*maxD, brng=Math.random()*2*Math.PI;
  const lat1=toRad(58.377679), lon1=toRad(26.717398);
  const lat2=Math.asin(Math.sin(lat1)*Math.cos(d/R)+Math.cos(lat1)*Math.sin(d/R)*Math.cos(brng));
  const lon2=lon1+Math.atan2(
    Math.sin(brng)*Math.sin(d/R)*Math.cos(lat1),
    Math.cos(d/R)-Math.sin(lat1)*Math.sin(lat2)
  );
  userLat=lat2*180/Math.PI; userLon=lon2*180/Math.PI;
  compassMarker.setLatLng([userLat,userLon]); map.setView([userLat,userLon]); pickTargets();
});

// Bookmark Toggle
bookmark.addEventListener('click',()=>bookmark.classList.toggle('bookmark-selected'));
