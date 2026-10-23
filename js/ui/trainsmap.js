// 지도 위 열차 위치: 운행 계통 열차는 계통 경로를 따라, 저절로 다니는 기본 열차는 구간마다 시간표대로 움직인다.
// 화면에 보이는 구간의 열차만 초당 몇 번 다시 그린다 (켜면 컴퓨터 부하가 커지므로 켤 때 묻는다).
// 시계는 1초에 1분씩 간다 (노선도와 따로).

const FPS = 5;
const MIN_PER_SEC = 1;
const COLORS = { hsr: '#2453c9', conv: '#6c3fa0', metro: '#1a9a6c', limited: '#c0392b', express: '#d68910', local: '#2471a3', commuter: '#0b7a8f' };

let timer = null, clock = 7 * 60, last = 0, data = null, provider = null, popup = null;

const KX = (lat) => 111.32 * Math.cos((lat * Math.PI) / 180);

/** 좌표열 → 누적 거리 (km) */
function measure(coords) {
  const cum = [0];
  for (let k = 1; k < coords.length; k++) {
    const [x0, y0] = coords[k - 1], [x1, y1] = coords[k];
    cum.push(cum[k - 1] + Math.hypot((x1 - x0) * KX(y0), (y1 - y0) * 110.57));
  }
  return cum;
}

function pointAt(coords, cum, d) {
  if (d <= 0) return coords[0];
  const total = cum[cum.length - 1];
  if (d >= total) return coords[coords.length - 1];
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= d) lo = m; else hi = m; }
  const t = (d - cum[lo]) / Math.max(1e-9, cum[hi] - cum[lo]);
  return [coords[lo][0] + t * (coords[hi][0] - coords[lo][0]), coords[lo][1] + t * (coords[hi][1] - coords[lo][1])];
}

export function addTrainsLayer(map) {
  if (map.getSource('trains-pos')) return;
  map.addSource('trains-pos', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'trains-pos', type: 'circle', source: 'trains-pos', layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 2, 10, 4, 13, 6],
      'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1,
    },
  });
  map.on('mousemove', 'trains-pos', (e) => {
    const f = e.features?.[0];
    if (!f) return;
    map.getCanvas().style.cursor = 'pointer';
    popup ||= new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
    popup.setLngLat(f.geometry.coordinates).setText(f.properties.label).addTo(map);
  });
  map.on('mouseleave', 'trains-pos', () => { map.getCanvas().style.cursor = ''; popup?.remove(); });
}

/**
 * @param {() => {links: {coords, trains, speed, cls, label}[], services: {coords, runMin, trains, kind, down, up}[]}} get
 *   links: 기본 열차가 다니는 구간(양방향 하루 열차 수), services: 운행 계통 (경로 좌표, 편도 분, 하루 열차 수, 하행·상행 안내)
 */
export function setTrainsProvider(get) { provider = get; data = null; }

/** 망이 바뀌면(해 넘김·착공) 다시 만든다 */
export function invalidateTrains() { data = null; }

export function trainsOn() { return !!timer; }

export function setTrains(map, on) {
  if (!map.getLayer('trains-pos')) return;
  map.setLayoutProperty('trains-pos', 'visibility', on ? 'visible' : 'none');
  if (timer) { clearInterval(timer); timer = null; }
  if (!on) { popup?.remove(); return; }
  last = performance.now();
  const tick = () => {
    const now = performance.now();
    clock = (clock + ((now - last) / 1000) * MIN_PER_SEC) % 1440;
    last = now;
    draw(map);
  };
  tick();
  timer = setInterval(tick, 1000 / FPS);
}

function build() {
  const raw = provider?.();
  if (!raw) return null;
  const links = raw.links.filter((l) => l.coords.length > 1).map((l) => {
    const cum = measure(l.coords), km = cum[cum.length - 1];
    const xs = l.coords.map((c) => c[0]), ys = l.coords.map((c) => c[1]);
    // 위상: 구간 시작점의 위치로 정해 이웃 구간끼리 열차가 대략 이어지게 한다
    const [x0, y0] = l.coords[0];
    const phase = ((x0 * KX(y0) + y0 * 110.57) / Math.max(20, l.speed)) * 60;
    return { ...l, cum, km, run: (km / Math.max(10, l.speed)) * 60, phase, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
  });
  const services = raw.services.filter((s) => s.coords.length > 1).map((s) => {
    const cum = measure(s.coords);
    const xs = s.coords.map((c) => c[0]), ys = s.coords.map((c) => c[1]);
    return { ...s, cum, km: cum[cum.length - 1], bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
  });
  return { links, services };
}

function draw(map) {
  data ||= build();
  if (!data) return;
  const b = map.getBounds(), W = b.getWest(), E = b.getEast(), S = b.getSouth(), N = b.getNorth();
  const inView = (bb) => bb[2] >= W && bb[0] <= E && bb[3] >= S && bb[1] <= N;
  const feats = [];
  const push = (c, color, label) => feats.push({ type: 'Feature', properties: { color, label }, geometry: { type: 'Point', coordinates: c } });
  for (const l of data.links) {
    if (!inView(l.bbox) || !(l.trains > 0)) continue;
    const perDir = Math.max(1, l.trains / 2), head = 1440 / perDir;
    for (const dir of [0, 1]) {
      const off = ((clock + l.phase + dir * head / 2) % head + head) % head;
      for (let t = off; t < l.run; t += head) {
        const d = (t / l.run) * l.km;
        push(pointAt(l.coords, l.cum, dir ? l.km - d : d), COLORS[l.cls] || COLORS.conv, l.label);
      }
    }
  }
  for (const s of data.services) {
    if (!inView(s.bbox) || !(s.trains > 0)) continue;
    const perDir = Math.max(1, Math.round(s.trains / 2)), head = 1440 / perDir;
    for (const dir of [0, 1]) {
      for (let n = 0; n < perDir; n++) {
        const e = ((clock - (n + dir * 0.5) * head) % 1440 + 1440) % 1440;
        if (e > s.runMin) continue;
        const d = (e / s.runMin) * s.km;
        push(pointAt(s.coords, s.cum, dir ? s.km - d : d), COLORS[s.kind] || COLORS.local, dir ? s.up : s.down);
      }
    }
  }
  map.getSource('trains-pos').setData({ type: 'FeatureCollection', features: feats });
}

export function trainsLegend() {
  return `<label class="legend-trains" style="display:flex;gap:4px;align-items:center;font-size:11px;margin-top:4px">
    <input type="checkbox" id="trains-toggle" ${timer ? 'checked' : ''}> 지도에 열차 위치 보기 <span class="m">(부하 큼)</span></label>`;
}
