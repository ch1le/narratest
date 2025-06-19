/*******************************************************************
 *  Mobile Orientation HUD – Leaflet + Compass + ORS Walking Routes
 *  ---------------------------------------------------------------
 *  • Leaflet map (OSM tiles)
 *  • Compass arrow rotates with device heading
 *  • Picks 3 “Y-shape” nearby targets
 *  • Draws a walking route from you → active target (ORS foot-walking)
 *  • Hides itinerary UI and waypoint dots
 *******************************************************************/

/* ---------- helpers ---------- */
const $ = (s) => document.querySelector(s);
const norm = (d) => ((d % 360) + 360) % 360;
const toRad = (d) => (d * Math.PI) / 180;
const diff = (a, b) => ((a - b + 540) % 360) - 180;

/* ---------- DOM ---------- */
const enableBtn = $("#enable");
const permBox = $("#permissionBox");
const permText = $("#permissionText");
const tagsRow = $("#selectorRow");
const titleEl = $("#titleText");
const descEl = $("#descBox");
const bookmark = $("#bookmark");
const loader = $("#loader");

/* ---------- constants ---------- */
const VIEW_TOL = 20;
const SPOKE_TOL = 25;
const SPOKE_ANG = 120;
const DOT_COL = "#ff9500";
const COMPASS_COL = "#0066ff";

/* ---------- state ---------- */
let DATA = null,
  map,
  userLat,
  userLon,
  alpha0 = null;
let targets = [],
  current = "",
  compass = null,
  routeCtrl = null;

/* ---------- load content + mock location ---------- */
Promise.all([
  fetch("content.json").then((r) => r.json()),
  new Promise((res) => {
    const MOCK = true; // flip to false for real GPS
    if (MOCK) {
      userLat = 58.377679;
      userLon = 26.717398;
      res();
    } else {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          userLat = coords.latitude;
          userLon = coords.longitude;
          res();
        },
        (err) => alert(err.message)
      );
    }
  }),
]).then(([json]) => {
  DATA = json;
  permText.textContent = json.permissionMessage.replace(/\\n/g, "\n");
});

/* ---------- tag toggle ---------- */
tagsRow.addEventListener("click", (e) => {
  if (e.target.classList.contains("tag"))
    e.target.classList.toggle("deselected");
});

/* ---------- permission flow ---------- */
enableBtn.addEventListener("click", start);

function start() {
  permBox.remove();
  buildMap();
  addCompass();
  initUI();
  chooseTargets();
  window.addEventListener("deviceorientation", handleOri);
}

/* ---------- build map ---------- */
function buildMap() {
  map = L.map("map", { zoomControl: false, attributionControl: false }).setView(
    [userLat, userLon],
    14
  );
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
  }).addTo(map);
}

/* ---------- compass marker ---------- */
function addCompass() {
  const html = `<div class="compass-icon">
    <svg width="28" height="28" viewBox="0 0 28 28">
      <polygon points="14,3 18,19 14,15 10,19" fill="${COMPASS_COL}"/>
    </svg></div>`;
  compass = L.marker([userLat, userLon], {
    icon: L.divIcon({
      className: "",
      html,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    }),
  }).addTo(map);
}

/* ---------- UI intro ---------- */
function initUI() {
  loader.style.display = "none";
  bookmark.style.display = "inline-block";
  bookmark.style.opacity = "1";
  titleEl.style.opacity = "1";
}

/* ---------- math helpers ---------- */
const hav = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3,
    φ1 = toRad(lat1),
    φ2 = toRad(lat2),
    dφ = toRad(lat2 - lat1),
    dλ = toRad(lon2 - lon1);
  const a =
    Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};
const brg = (lat1, lon1, lat2, lon2) => {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.cos(toRad(lon2 - lon1));
  return norm((Math.atan2(y, x) * 180) / Math.PI);
};

/* ---------- pick 3 Y-shape targets ---------- */
function chooseTargets() {
  const list = DATA.targets
    .map((t) => ({
      ...t,
      dist: hav(userLat, userLon, t.lat, t.lon),
      bear: brg(userLat, userLon, t.lat, t.lon),
    }))
    .sort((a, b) => a.dist - b.dist);

  const first = list[0];
  const spokes = [norm(first.bear + SPOKE_ANG), norm(first.bear - SPOKE_ANG)];
  const pick = (dir) =>
    list
      .filter((t) => Math.abs(diff(dir, t.bear)) < SPOKE_TOL)
      .sort((a, b) => a.dist - b.dist)[0];

  targets = [first, pick(spokes[0]), pick(spokes[1])].filter(Boolean);

  const dots = targets.map((t) =>
    L.circleMarker([t.lat, t.lon], {
      radius: 6,
      color: DOT_COL,
      weight: 1,
      fillOpacity: 1,
    }).addTo(map)
  );
  map.fitBounds(L.featureGroup(dots).getBounds().pad(0.125));

  showTarget(first);
}

/* ---------- helper: wait for ORS router to register ---------- */
function buildORSRouter() {
  return new Promise((res) => {
    const key = "5b3ce3597851110001cf624832d9077792624247bec931918dc4e43b"; // ← paste key
    const tick = () => {
      if (L.Routing.openrouteservice) {
        res(L.Routing.openrouteservice(key, { profile: "foot-walking" }));
      } else requestAnimationFrame(tick);
    };
    tick();
  });
}

/* ---------- display one target & route ---------- */
async function showTarget(t) {
  titleEl.textContent = t.name;
  descEl.textContent = t.desc;
  descEl.style.opacity = "1";
  current = t.name;

  if (routeCtrl) {
    routeCtrl.setWaypoints([
      [userLat, userLon],
      [t.lat, t.lon],
    ]);
  } else {
    const orsRouter = await buildORSRouter();
    routeCtrl = L.Routing.control({
      waypoints: [
        [userLat, userLon],
        [t.lat, t.lon],
      ],
      router: orsRouter,
      lineOptions: { styles: [{ color: "#000", weight: 3 }] },
      createMarker: () => null,
      addWaypoints: false,
      draggableWaypoints: false,
      fitSelectedRoutes: false,
      showAlternatives: false,
      show: false,
    }).addTo(map);
    document
      .querySelectorAll(".leaflet-routing-container")
      .forEach((el) => (el.style.display = "none"));
  }
}

/* ---------- orientation handler ---------- */
function handleOri({ alpha = 0 }) {
  if (!DATA) return;
  alpha = norm(alpha);
  if (alpha0 === null) alpha0 = alpha;

  const head = norm(alpha0 - alpha); // CW+
  compass
    .getElement()
    .querySelector("svg").style.transform = `rotate(${head}deg)`;

  targets.forEach((t) => {
    if (Math.abs(diff(head, t.bear)) < VIEW_TOL && current !== t.name) {
      showTarget(t);
    }
  });
}

/* ---------- bookmark ---------- */
bookmark.addEventListener("click", () =>
  bookmark.classList.toggle("bookmark-selected")
);