/**
 * 联网查询工具：天气 + 地点检索（v1.77）
 *
 * 设计原则（与项目其它工具一致）：
 *   · **免密钥**：用 Open-Meteo（地理编码 + 天气）与 OpenStreetMap Nominatim（地点），不需要 API key；
 *   · **有界**：单次 6s 超时、结果裁剪、内存缓存 10 分钟（避免同一问题反复打外部服务）；
 *   · **失败即如实**：任何异常都返回 { ok:false, error }，由 agent 如实说"没查到"，绝不编天气；
 *   · **隐私**：只发送用户给出的城市/地点字符串；不上传对话、不上传精确位置。
 *
 * 开关：`ENABLE_AGENT_EXTERNAL_TOOLS=true`（默认关）。
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export const EXTERNAL_TIMEOUT_MS = 6_000;
export const MAP_LIMIT = 3;
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 64;

export function externalToolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ENABLE_AGENT_EXTERNAL_TOOLS === 'true';
}

/**
 * JSON 抓取器。默认实现：**先试 Node fetch，失败回退 curl**。
 * 为什么需要兜底：某些环境里 Node 的 undici 连不上外网（UND_ERR_CONNECT_TIMEOUT），
 * 但系统 curl 是通的；这条回退让工具在两种环境都能用。
 * 测试时注入 stub，不发真实网络。
 */
export type JsonGetter = (url: string, headers?: Record<string, string>) => Promise<unknown>;

async function curlJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const out = join(tmpdir(), `ea-ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  const args = ['-sS', '-L', '--max-time', String(Math.ceil(EXTERNAL_TIMEOUT_MS / 1000)), '-o', out, url];
  const ua = headers['User-Agent'] ?? 'EmotionAI/1.0 (local companion app)';
  args.unshift('-A', ua);
  if (headers['Accept']) args.unshift('-H', `Accept: ${headers['Accept']}`);
  try {
    const code = await new Promise<number>((resolve) => {
      const child = spawn('curl', args, { stdio: 'ignore', windowsHide: true });
      const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, EXTERNAL_TIMEOUT_MS + 2000);
      child.on('close', c => { clearTimeout(timer); resolve(c ?? 1); });
      child.on('error', () => { clearTimeout(timer); resolve(1); });
    });
    if (code !== 0 || !existsSync(out)) throw new Error(`curl exit ${code}`);
    const text = readFileSync(out, 'utf8');
    return JSON.parse(text) as unknown;
  } finally {
    try { if (existsSync(out)) unlinkSync(out); } catch { /* ignore */ }
  }
}

export async function defaultJsonGetter(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return (await res.json()) as unknown;
  } catch {
    return curlJson(url, headers);          // Node 连不上就回退 curl
  }
}

const cache = new Map<string, { ts: number; value: unknown }>();

function cacheGet<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit.value as T;
}

function cacheSet(key: string, value: unknown): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  cache.set(key, { ts: Date.now(), value });
}

export function resetExternalCache(): void {
  cache.clear();
}

/** WMO 天气代码 → 人话（中文） */
export function weatherCodeText(code: number): string {
  const map: Record<number, string> = {
    0: '晴', 1: '大致晴朗', 2: '多云', 3: '阴',
    45: '有雾', 48: '雾凇',
    51: '小毛毛雨', 53: '毛毛雨', 55: '大毛毛雨',
    56: '冻毛毛雨', 57: '强冻毛毛雨',
    61: '小雨', 63: '雨', 65: '大雨',
    66: '冻雨', 67: '强冻雨',
    71: '小雪', 73: '雪', 75: '大雪', 77: '雪粒',
    80: '阵雨', 81: '强阵雨', 82: '暴雨',
    85: '阵雪', 86: '强阵雪',
    95: '雷阵雨', 96: '雷阵雨伴冰雹', 99: '强雷暴伴冰雹',
  };
  return map[code] ?? `天气代码 ${code}`;
}

export interface WeatherResult {
  ok: boolean;
  city?: string;
  country?: string;
  temperatureC?: number;
  feelsLikeC?: number;
  humidity?: number;
  windKmh?: number;
  description?: string;
  observedAt?: string;
  error?: string;
}

interface GeoHit { name: string; country?: string; latitude: number; longitude: number }

async function geocode(city: string, f: JsonGetter): Promise<GeoHit | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh&format=json`;
  const data = (await f(url)) as { results?: Array<{ name?: string; country?: string; latitude?: number; longitude?: number }> };
  const hit = data.results?.[0];
  if (!hit || typeof hit.latitude !== 'number' || typeof hit.longitude !== 'number') return null;
  return { name: String(hit.name ?? city), country: hit.country ? String(hit.country) : undefined, latitude: hit.latitude, longitude: hit.longitude };
}

/** 查天气：城市名（中文/英文都行）→ 当前天气 */
export async function getWeather(city: string, getJson: JsonGetter = defaultJsonGetter): Promise<WeatherResult> {
  const name = String(city ?? '').trim();
  if (!name) return { ok: false, error: 'missing_city（要查哪个城市？）' };
  if (name.length > 40) return { ok: false, error: 'city_too_long' };
  const key = `weather:${name}`;
  const cached = cacheGet<WeatherResult>(key);
  if (cached) return cached;

  try {
    const geo = await geocode(name, getJson);
    if (!geo) return { ok: false, error: `没找到「${name}」这个地点` };
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}`
      + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto';
    const data = (await getJson(url)) as {
      current?: { temperature_2m?: number; relative_humidity_2m?: number; apparent_temperature?: number; weather_code?: number; wind_speed_10m?: number; time?: string };
    };
    const cur = data.current;
    if (!cur || typeof cur.temperature_2m !== 'number') return { ok: false, error: '天气服务没有返回当前数据' };
    const value: WeatherResult = {
      ok: true,
      city: geo.name,
      ...(geo.country ? { country: geo.country } : {}),
      temperatureC: Math.round(cur.temperature_2m * 10) / 10,
      ...(typeof cur.apparent_temperature === 'number' ? { feelsLikeC: Math.round(cur.apparent_temperature * 10) / 10 } : {}),
      ...(typeof cur.relative_humidity_2m === 'number' ? { humidity: Math.round(cur.relative_humidity_2m) } : {}),
      ...(typeof cur.wind_speed_10m === 'number' ? { windKmh: Math.round(cur.wind_speed_10m * 10) / 10 } : {}),
      description: weatherCodeText(Number(cur.weather_code ?? -1)),
      ...(cur.time ? { observedAt: String(cur.time) } : {}),
    };
    cacheSet(key, value);
    return value;
  } catch (e) {
    return { ok: false, error: `查询失败：${e instanceof Error ? e.message : 'network_error'}` };
  }
}

export interface PlaceHit {
  name: string;
  address?: string;
  type?: string;
  lat: number;
  lon: number;
}

export interface MapResult {
  ok: boolean;
  query?: string;
  places?: PlaceHit[];
  error?: string;
  /** 明确说明这是**地名库**检索，不是完整地图 POI 检索 */
  note?: string;
}

/**
 * 地点检索：用 Open-Meteo 的地理编码库（OSM 地名库，免 key，与天气同源、可达性好）。
 * ⚠️ 它给的是**地名/行政区/坐标**，不是完整的 POI 地图（查"外滩某家店"这类会查不到）。
 * 查不到就如实返回错误，绝不编地址。
 */
export async function searchPlace(query: string, getJson: JsonGetter = defaultJsonGetter): Promise<MapResult> {
  const q = String(query ?? '').trim();
  if (!q) return { ok: false, error: 'missing_query（要找什么地方？）' };
  if (q.length > 60) return { ok: false, error: 'query_too_long' };
  const key = `map:${q}`;
  const cached = cacheGet<MapResult>(key);
  if (cached) return cached;

  const note = '这是地名库检索（名称/省份/国家/坐标），不是完整地图 POI；查不到的具体店铺/门牌会查不到。';
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=${MAP_LIMIT}&language=zh&format=json`;
    const data = (await getJson(url)) as {
      results?: Array<{
        name?: string; country?: string; admin1?: string; admin2?: string;
        latitude?: number; longitude?: number; elevation?: number; timezone?: string; feature_code?: string;
      }>;
    };
    const rows = Array.isArray(data.results) ? data.results : [];
    if (rows.length === 0) return { ok: false, error: `没找到「${q}」相关的地名`, note };
    const places: PlaceHit[] = rows.slice(0, MAP_LIMIT).map(r => ({
      name: String(r.name ?? q),
      ...(r.admin1 || r.country ? { address: [r.admin1, r.admin2, r.country].filter(Boolean).join(' · ') } : {}),
      ...(r.feature_code ? { type: String(r.feature_code) } : {}),
      lat: Math.round(Number(r.latitude) * 1e5) / 1e5,
      lon: Math.round(Number(r.longitude) * 1e5) / 1e5,
    })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    if (places.length === 0) return { ok: false, error: `没找到「${q}」相关的地名`, note };
    const value: MapResult = { ok: true, query: q, places, note };
    cacheSet(key, value);
    return value;
  } catch (e) {
    return { ok: false, error: `查询失败：${e instanceof Error ? e.message : 'network_error'}`, note };
  }
}