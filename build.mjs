import fs from 'fs';
import path from 'path';

// City colors — auto-assigned if new cities appear
const CITY_COLORS = {
  'Chicago': { hex: '#2563eb', bg: '#dbeafe', text: '#1d4ed8', abbr: 'Chicago' },
  'Los Angeles': { hex: '#ea580c', bg: '#ffedd5', text: '#c2410c', abbr: 'LA' },
  'New York City': { hex: '#dc2626', bg: '#fee2e2', text: '#b91c1c', abbr: 'NYC' },
  'Portland': { hex: '#7c3aed', bg: '#ede9fe', text: '#6d28d9', abbr: 'Portland' },
  'San Francisco': { hex: '#16a34a', bg: '#dcfce7', text: '#15803d', abbr: 'SF' },
};

const FALLBACK_COLORS = [
  { hex: '#0891b2', bg: '#cffafe', text: '#0e7490' },
  { hex: '#be185d', bg: '#fce7f3', text: '#9d174d' },
  { hex: '#a16207', bg: '#fef3c7', text: '#92400e' },
  { hex: '#4338ca', bg: '#e0e7ff', text: '#3730a3' },
];

function getCityConfig(cities) {
  const config = {};
  let fallbackIdx = 0;
  for (const city of cities.sort()) {
    if (CITY_COLORS[city]) {
      config[city] = CITY_COLORS[city];
    } else {
      const fb = FALLBACK_COLORS[fallbackIdx % FALLBACK_COLORS.length];
      config[city] = { ...fb, abbr: city.replace(/\s+/g, '') };
      fallbackIdx++;
    }
  }
  return config;
}

function buildHTML(restaurants, cityConfig) {
  const cities = Object.keys(cityConfig).sort();
  const cuisines = [...new Set(restaurants.map(r => r.cuisine))].sort();

  // Count restaurants per city
  const cityCounts = {};
  restaurants.forEach(r => { cityCounts[r.city] = (cityCounts[r.city] || 0) + 1; });

  const cityBadgeCSS = cities.map(c =>
    `.city-${cityConfig[c].abbr} .card-cuisine{background:${cityConfig[c].bg};color:${cityConfig[c].text}}`
  ).join('\n');

  // Generate city options for dropdown
  const cityOptionsHTML = cities.map(c =>
    `        <option value="${c}">${c} (${cityCounts[c] || 0})</option>`
  ).join('\n');

  // Generate getCityClass cases
  const cityClassCases = cities.map(c =>
    `    if (city === '${c}') return 'city-${cityConfig[c].abbr}';`
  ).join('\n');

  // Generate cityColors JS object
  const cityColorsJS = cities.map(c =>
    `  "${c}": "${cityConfig[c].hex}"`
  ).join(',\n');

  // Sanitize restaurant data for embedding (escape quotes in strings)
  const restaurantJSON = restaurants.map(r => {
    const esc = s => (s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
    return `  {name:"${esc(r.name)}",cuisine:"${esc(r.cuisine)}",neighborhood:"${esc(r.neighborhood)}",city:"${esc(r.city)}",description:"${esc(r.description)}",url:"${esc(r.url)}",lat:${r.lat},lng:${r.lng}}`;
  }).join(',\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Chase Sapphire Reserve Exclusive Tables — Map</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css" />
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css" />
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;height:100vh;background:#f5f5f5}
#sidebar{width:380px;height:100vh;display:flex;flex-direction:column;background:#fff;border-right:1px solid #ddd;overflow:hidden;z-index:1000}
#sidebar-header{padding:16px;background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff}
#sidebar-header h1{font-size:18px;margin-bottom:4px;letter-spacing:0.5px}
#sidebar-header .subtitle{font-size:12px;color:#a0c4ff;margin-bottom:12px}
.filters{padding:12px 16px;border-bottom:1px solid #eee;background:#fafafa}
.filter-row{display:flex;gap:8px;margin-bottom:8px}
.filter-row:last-child{margin-bottom:0}
.filter-select{flex:1;padding:8px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px;background:#fff;cursor:pointer;appearance:auto}
.filter-label{font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px}
#search-input{width:100%;padding:8px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px;background:#fff}
#search-input:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 2px rgba(37,99,235,0.15)}
.count-bar{padding:8px 16px;font-size:12px;color:#666;border-bottom:1px solid #eee;background:#fafafa}
#restaurant-list{flex:1;overflow-y:auto;padding:8px}
.restaurant-card{padding:12px;margin-bottom:6px;border-radius:10px;border:1px solid #eee;cursor:pointer;transition:all 0.15s}
.restaurant-card:hover{border-color:#aaa;box-shadow:0 2px 8px rgba(0,0,0,0.08)}
.restaurant-card.active{border-color:#2563eb;background:#eff6ff;box-shadow:0 2px 12px rgba(37,99,235,0.15)}
.card-name{font-size:14px;font-weight:600;margin-bottom:3px}
.card-meta{font-size:12px;color:#666}
.card-cuisine{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:500;margin-top:4px}
${cityBadgeCSS}
.city-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle}
#map{flex:1;height:100vh}
.leaflet-popup-content-wrapper{border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.15)}
.leaflet-popup-content{margin:12px 16px;min-width:220px;max-width:300px}
.popup-name{font-size:15px;font-weight:700;margin-bottom:4px}
.popup-cuisine{font-size:12px;color:#666;margin-bottom:2px}
.popup-hood{font-size:12px;color:#888;margin-bottom:8px}
.popup-desc{font-size:12px;color:#444;line-height:1.4;margin-bottom:10px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.popup-link{display:inline-block;padding:6px 14px;background:#da3743;color:#fff;text-decoration:none;border-radius:6px;font-size:12px;font-weight:500;transition:background 0.2s}
.popup-link:hover{background:#b91c1c}
@media(max-width:768px){
  body{flex-direction:column}
  #sidebar{width:100%;height:45vh;border-right:none;border-bottom:1px solid #ddd}
  #map{height:55vh}
}
</style>
</head>
<body>
<div id="sidebar">
  <div id="sidebar-header">
    <h1>Sapphire Reserve Exclusive Tables</h1>
    <div class="subtitle">Chase Sapphire Reserve x OpenTable</div>
  </div>
  <div class="filters">
    <div class="filter-row">
      <select id="city-filter" class="filter-select">
        <option value="all">All Cities (${restaurants.length})</option>
${cityOptionsHTML}
      </select>
      <select id="cuisine-filter" class="filter-select"><option value="all">All Cuisines</option></select>
    </div>
    <div class="filter-row">
      <input type="text" id="search-input" placeholder="Search restaurants..." />
    </div>
  </div>
  <div class="count-bar">Showing <strong id="count">0</strong> of <strong id="total">0</strong> restaurants</div>
  <div id="restaurant-list"></div>
</div>
<div id="map"></div>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"><\/script>
<script>
var restaurants = [
${restaurantJSON}
];

var cityColors = {
${cityColorsJS}
};

var map = L.map('map', { zoomControl: true });
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
  subdomains: 'abcd',
  maxZoom: 20
}).addTo(map);

var clusterGroup = L.markerClusterGroup({
  maxClusterRadius: 40,
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false
});

var markerMap = {};
restaurants.forEach(function(r, i) {
  if (r.lat == null || r.lng == null) return; // skip ungeocoded
  var color = cityColors[r.city] || '#666';
  var icon = L.divIcon({
    className: 'custom-marker',
    html: '<div style="width:14px;height:14px;border-radius:50%;background:' + color + ';border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3)"></div>',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -10]
  });

  var desc = r.description.length > 150 ? r.description.substring(0, 150) + '...' : r.description;

  var popupEl = document.createElement('div');
  var pName = document.createElement('div');
  pName.className = 'popup-name';
  pName.textContent = r.name;
  popupEl.appendChild(pName);
  var pCuisine = document.createElement('div');
  pCuisine.className = 'popup-cuisine';
  pCuisine.textContent = r.cuisine;
  popupEl.appendChild(pCuisine);
  var pHood = document.createElement('div');
  pHood.className = 'popup-hood';
  pHood.textContent = r.neighborhood + ', ' + r.city;
  popupEl.appendChild(pHood);
  var pDesc = document.createElement('div');
  pDesc.className = 'popup-desc';
  pDesc.textContent = desc;
  popupEl.appendChild(pDesc);
  var pLink = document.createElement('a');
  pLink.className = 'popup-link';
  pLink.href = r.url;
  pLink.target = '_blank';
  pLink.rel = 'noopener';
  pLink.textContent = 'View on OpenTable';
  popupEl.appendChild(pLink);

  var marker = L.marker([r.lat, r.lng], { icon: icon }).bindPopup(popupEl);
  marker.on('click', function() { highlightCard(i); });
  markerMap[i] = marker;
  clusterGroup.addLayer(marker);
});
map.addLayer(clusterGroup);

var allCoords = restaurants.filter(function(r) { return r.lat != null; }).map(function(r) { return [r.lat, r.lng]; });
if (allCoords.length > 0) map.fitBounds(allCoords, { padding: [30, 30] });

// Populate cuisine filter
var cuisineSet = {};
restaurants.forEach(function(r) { cuisineSet[r.cuisine] = true; });
var cuisines = Object.keys(cuisineSet).sort();
var cuisineSelect = document.getElementById('cuisine-filter');
cuisines.forEach(function(c) {
  var opt = document.createElement('option');
  opt.value = c;
  opt.textContent = c;
  cuisineSelect.appendChild(opt);
});

var activeCity = 'all';
var activeCuisine = 'all';
var searchQuery = '';

function getCityClass(city) {
${cityClassCases}
    return '';
}

function getFilteredIndices() {
  var q = searchQuery.toLowerCase();
  var result = [];
  restaurants.forEach(function(r, i) {
    var cityMatch = activeCity === 'all' || r.city === activeCity;
    var cuisineMatch = activeCuisine === 'all' || r.cuisine === activeCuisine;
    var searchMatch = !q || r.name.toLowerCase().indexOf(q) >= 0 || r.neighborhood.toLowerCase().indexOf(q) >= 0 || r.cuisine.toLowerCase().indexOf(q) >= 0;
    if (cityMatch && cuisineMatch && searchMatch) result.push(i);
  });
  return result;
}

function render() {
  var indices = getFilteredIndices();
  document.getElementById('count').textContent = indices.length;
  document.getElementById('total').textContent = restaurants.length;

  clusterGroup.clearLayers();
  indices.forEach(function(i) { if (markerMap[i]) clusterGroup.addLayer(markerMap[i]); });

  if (indices.length > 0) {
    var coords = indices.filter(function(i) { return markerMap[i]; }).map(function(i) { return [restaurants[i].lat, restaurants[i].lng]; });
    if (coords.length > 0) map.fitBounds(coords, { padding: [30, 30], maxZoom: 14 });
  }

  var list = document.getElementById('restaurant-list');
  list.textContent = '';
  indices.forEach(function(i) {
    var r = restaurants[i];
    var card = document.createElement('div');
    card.className = 'restaurant-card ' + getCityClass(r.city);
    card.dataset.index = i;

    var nameDiv = document.createElement('div');
    nameDiv.className = 'card-name';
    var dot = document.createElement('span');
    dot.className = 'city-dot';
    dot.style.background = cityColors[r.city] || '#666';
    nameDiv.appendChild(dot);
    nameDiv.appendChild(document.createTextNode(r.name));
    card.appendChild(nameDiv);

    var metaDiv = document.createElement('div');
    metaDiv.className = 'card-meta';
    metaDiv.textContent = r.neighborhood + ', ' + r.city;
    card.appendChild(metaDiv);

    var cuisineSpan = document.createElement('span');
    cuisineSpan.className = 'card-cuisine';
    cuisineSpan.textContent = r.cuisine;
    card.appendChild(cuisineSpan);

    card.addEventListener('click', (function(idx, rest) {
      return function() {
        if (!markerMap[idx]) return;
        clusterGroup.zoomToShowLayer(markerMap[idx], function() {
          markerMap[idx].openPopup();
        });
        map.setView([rest.lat, rest.lng], Math.max(map.getZoom(), 14));
        highlightCard(idx);
      };
    })(i, r));

    list.appendChild(card);
  });
}

function highlightCard(index) {
  var cards = document.querySelectorAll('.restaurant-card');
  for (var j = 0; j < cards.length; j++) cards[j].classList.remove('active');
  var card = document.querySelector('.restaurant-card[data-index="' + index + '"]');
  if (card) {
    card.classList.add('active');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

document.getElementById('city-filter').addEventListener('change', function() {
  activeCity = this.value;
  render();
});

cuisineSelect.addEventListener('change', function() {
  activeCuisine = cuisineSelect.value;
  render();
});

var searchTimeout;
document.getElementById('search-input').addEventListener('input', function() {
  clearTimeout(searchTimeout);
  var input = this;
  searchTimeout = setTimeout(function() {
    searchQuery = input.value;
    render();
  }, 200);
});

render();
<\/script>
</body>
</html>`;
}

function main() {
  const dataPath = path.join(process.cwd(), 'data', 'restaurants.json');
  if (!fs.existsSync(dataPath)) {
    console.error('Error: data/restaurants.json not found. Run "npm run scrape" first.');
    process.exit(1);
  }

  const restaurants = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const validRestaurants = restaurants.filter(r => r.lat != null && r.lng != null);
  const skipped = restaurants.length - validRestaurants.length;

  if (skipped > 0) {
    console.log(`Warning: ${skipped} restaurants skipped (no coordinates). Edit data/restaurants.json to add lat/lng.`);
  }

  const cities = [...new Set(restaurants.map(r => r.city))];
  const cityConfig = getCityConfig(cities);

  console.log(`Building index.html with ${validRestaurants.length} restaurants across ${cities.length} cities...`);
  console.log(`Cities: ${cities.join(', ')}`);

  const html = buildHTML(restaurants, cityConfig);
  const outPath = path.join(process.cwd(), 'index.html');
  fs.writeFileSync(outPath, html);
  console.log(`Written to ${outPath}`);
}

main();
