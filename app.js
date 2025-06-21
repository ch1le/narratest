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
  const btn = document.createElement('button');
