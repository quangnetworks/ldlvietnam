import { useCallback, useEffect, useState } from 'react';
import { MapPin, RefreshCw, Droplets, Wind, LocateFixed } from 'lucide-react';
import { cx } from '../utils.js';

/**
 * Thời tiết tại vị trí hiện tại (Open-Meteo, không cần khoá API).
 * Vị trí: định vị của trình duyệt → nếu bị từ chối thì ước lượng theo địa chỉ IP → mặc định Hà Nội.
 * Kết quả lưu tạm 20 phút trên trình duyệt.
 */
const CACHE_KEY = 'ldl.weather.v1';
const TTL = 20 * 60e3;
const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

// Mã thời tiết WMO → mô tả tiếng Việt + biểu tượng (ngày / đêm)
const WMO = [
  [[0], 'Trời quang', '☀️', '🌙'],
  [[1], 'Ít mây', '🌤️', '🌙'],
  [[2], 'Có mây', '⛅', '☁️'],
  [[3], 'Nhiều mây', '☁️', '☁️'],
  [[45, 48], 'Sương mù', '🌫️', '🌫️'],
  [[51, 53, 55, 56, 57], 'Mưa phùn', '🌦️', '🌧️'],
  [[61, 63, 66, 80], 'Mưa', '🌧️', '🌧️'],
  [[65, 67, 81, 82], 'Mưa to', '🌧️', '🌧️'],
  [[71, 73, 75, 77, 85, 86], 'Tuyết', '🌨️', '🌨️'],
  [[95], 'Dông', '⛈️', '⛈️'],
  [[96, 99], 'Dông kèm mưa đá', '⛈️', '⛈️'],
];
export function describe(code, isDay = 1) {
  const w = WMO.find(([codes]) => codes.includes(code)) || WMO[2];
  return { text: w[1], icon: isDay ? w[2] : w[3] };
}

function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    return c && Date.now() - c.at < TTL ? c : null;
  } catch { return null; }
}

const getJson = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

function browserPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('no-geo'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, source: 'gps' }),
      reject, { enableHighAccuracy: false, timeout: 8000, maximumAge: 15 * 60e3 },
    );
  });
}

async function locate() {
  try { return await browserPosition(); } catch { /* bị từ chối / không hỗ trợ */ }
  try {
    const g = await getJson('https://get.geojs.io/v1/ip/geo.json');
    if (g.latitude && g.longitude) return { lat: Number(g.latitude), lon: Number(g.longitude), name: g.city || g.region, source: 'ip' };
  } catch { /* bỏ qua */ }
  return { lat: 21.0285, lon: 105.8542, name: 'Hà Nội', source: 'default' };
}

async function placeName(pos) {
  if (pos.name && pos.source !== 'gps') return pos.name;
  try {
    const r = await getJson(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${pos.lat}&longitude=${pos.lon}&localityLanguage=vi`);
    return r.locality || r.city || r.principalSubdivision || pos.name || 'Vị trí hiện tại';
  } catch { return pos.name || 'Vị trí hiện tại'; }
}

async function loadWeather() {
  const pos = await locate();
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${pos.lat.toFixed(3)}&longitude=${pos.lon.toFixed(3)}`
    + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,is_day'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=4';
  const [w, name] = await Promise.all([getJson(url), placeName(pos)]);
  const data = { at: Date.now(), place: name, source: pos.source, current: w.current, daily: w.daily };
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* bỏ qua */ }
  return data;
}

/** Lời nhắc ngắn theo thời tiết hôm nay. */
function advice(d) {
  const rain = d.daily?.precipitation_probability_max?.[0] ?? 0;
  const max = d.daily?.temperature_2m_max?.[0] ?? d.current.temperature_2m;
  const code = d.current.weather_code;
  if ([95, 96, 99].includes(code)) return 'Có dông — hạn chế di chuyển ngoài trời';
  if (rain >= 60) return `Khả năng mưa ${rain}% — nhớ mang áo mưa`;
  if (max >= 35) return 'Nắng nóng — uống đủ nước khi đi thị trường';
  if (max <= 15) return 'Trời lạnh — giữ ấm khi ra ngoài';
  return null;
}

export default function HomeWeather() {
  const [data, setData] = useState(readCache);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const refresh = useCallback(async (force) => {
    if (!force && readCache()) return;
    setLoading(true); setError(false);
    try { setData(await loadWeather()); } catch { setError(true); } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    refresh(false);
    const t = setInterval(() => !document.hidden && refresh(false), TTL);
    return () => clearInterval(t);
  }, [refresh]);

  if (!data) {
    return (
      <div className="weather glass-dark">
        <span className="weather-empty">{error ? 'Không tải được thời tiết' : 'Đang lấy thời tiết…'}</span>
        {error && <button className="icon-btn sm on-dark" onClick={() => refresh(true)} aria-label="Thử lại"><RefreshCw size={14} /></button>}
      </div>
    );
  }
  const c = data.current;
  const now = describe(c.weather_code, c.is_day);
  const tip = advice(data);
  return (
    <div className={cx('weather glass-dark', loading && 'refetching')}>
      <div className="weather-main">
        <span className="weather-icon" aria-hidden>{now.icon}</span>
        <div>
          <div className="weather-temp">{Math.round(c.temperature_2m)}°<small>C</small></div>
          <div className="weather-desc">{now.text} · cảm giác {Math.round(c.apparent_temperature)}°</div>
        </div>
        <div className="weather-side">
          <div className="weather-place" title={data.source === 'gps' ? 'Theo định vị của thiết bị' : data.source === 'ip' ? 'Ước lượng theo mạng — bật định vị để chính xác hơn' : 'Mặc định — bật định vị để xem theo vị trí của bạn'}>
            {data.source === 'gps' ? <LocateFixed size={12} /> : <MapPin size={12} />} {data.place}
          </div>
          <div className="weather-meta"><Droplets size={12} /> {c.relative_humidity_2m}% · <Wind size={12} /> {Math.round(c.wind_speed_10m)} km/h</div>
          <button className="icon-btn sm on-dark" onClick={() => refresh(true)} title="Cập nhật thời tiết" aria-label="Cập nhật thời tiết"><RefreshCw size={13} /></button>
        </div>
      </div>
      {data.daily && (
        <div className="weather-days">
          {data.daily.time.map((day, i) => {
            const d = describe(data.daily.weather_code[i], 1);
            return (
              <div key={day} className="weather-day" title={d.text}>
                <small>{i === 0 ? 'Hôm nay' : DOW[new Date(`${day}T00:00:00`).getDay()]}</small>
                <span aria-hidden>{d.icon}</span>
                <b>{Math.round(data.daily.temperature_2m_max[i])}°</b><small className="lo">{Math.round(data.daily.temperature_2m_min[i])}°</small>
                {data.daily.precipitation_probability_max?.[i] >= 30 && <small className="rain">💧{data.daily.precipitation_probability_max[i]}%</small>}
              </div>
            );
          })}
        </div>
      )}
      {tip && <div className="weather-tip">{tip}</div>}
    </div>
  );
}
