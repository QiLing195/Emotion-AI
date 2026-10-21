import { describe, it, expect, beforeEach } from 'vitest';
import {
  externalToolsEnabled,
  getWeather,
  resetExternalCache,
  searchPlace,
  weatherCodeText,
  type JsonGetter,
} from '../externalLookup.js';

const geoStub = (results: unknown) => async () => ({ results });
const forecastStub = (current: unknown) => async () => ({ current });

beforeEach(() => resetExternalCache());

describe('开关与天气代码', () => {
  it('默认关', () => {
    expect(externalToolsEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(externalToolsEnabled({ ENABLE_AGENT_EXTERNAL_TOOLS: 'true' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('WMO 代码 → 人话（含未知码）', () => {
    expect(weatherCodeText(0)).toBe('晴');
    expect(weatherCodeText(61)).toBe('小雨');
    expect(weatherCodeText(95)).toBe('雷阵雨');
    expect(weatherCodeText(12345)).toContain('12345');
  });
});

describe('天气：解析 / 错误 / 缓存', () => {
  it('地理编码 + 当前天气 ⇒ 结构化结果', async () => {
    const getJson: JsonGetter = (url) => {
      if (url.includes('geocoding')) return Promise.resolve({ results: [{ name: '北京', country: '中国', latitude: 39.9, longitude: 116.4 }] });
      return Promise.resolve({ current: { temperature_2m: 8.84, apparent_temperature: 5.2, relative_humidity_2m: 55.4, weather_code: 0, wind_speed_10m: 10.44, time: '2026-10-21T23:15' } });
    };
    const w = await getWeather('北京', getJson);
    expect(w.ok).toBe(true);
    expect(w.city).toBe('北京');
    expect(w.temperatureC).toBe(8.8);
    expect(w.description).toBe('晴');
    expect(w.humidity).toBe(55);
  });

  it('地名查不到 ⇒ 如实失败，不编天气', async () => {
    const w = await getWeather('不存在的地名xyz', geoStub(undefined));
    expect(w.ok).toBe(false);
    expect(String(w.error)).toContain('没找到');
    expect(w.temperatureC).toBeUndefined();
  });

  it('天气服务没数据 ⇒ 如实失败', async () => {
    const getJson: JsonGetter = (url) => (url.includes('geocoding')
      ? Promise.resolve({ results: [{ name: '北京', latitude: 1, longitude: 2 }] })
      : Promise.resolve({}));
    const w = await getWeather('北京', getJson);
    expect(w.ok).toBe(false);
  });

  it('同一城市第二次走缓存（不再发请求）', async () => {
    let calls = 0;
    const getJson: JsonGetter = (url) => {
      calls++;
      if (url.includes('geocoding')) return Promise.resolve({ results: [{ name: '上海', country: '中国', latitude: 31.2, longitude: 121.5 }] });
      return Promise.resolve({ current: { temperature_2m: 19.9, weather_code: 1, relative_humidity_2m: 60 } });
    };
    await getWeather('上海', getJson);
    const before = calls;
    const second = await getWeather('上海', getJson);
    expect(calls).toBe(before);
    expect(second.ok).toBe(true);
  });

  it('空城市 ⇒ 直接拒绝', async () => {
    expect((await getWeather('')).ok).toBe(false);
  });
});

describe('地名检索：解析 / 查不到 / 说明它是地名库', () => {
  it('返回名称/省份/国家/坐标', async () => {
    const getJson: JsonGetter = () => Promise.resolve({
      results: [{ name: '杭州', admin1: '浙江', admin2: '杭州市', country: '中国', latitude: 30.29365, longitude: 120.16142, feature_code: 'PPLA' }],
    });
    const m = await searchPlace('杭州', getJson);
    expect(m.ok).toBe(true);
    expect(m.places?.[0].name).toBe('杭州');
    expect(m.places?.[0].address).toContain('浙江');
    expect(m.places?.[0].lat).toBe(30.29365);
    expect(String(m.note)).toContain('地名库');
  });

  it('查不到 ⇒ 如实失败 + 保留说明', async () => {
    const m = await searchPlace('不存在的地方xyz', geoStub(undefined) as JsonGetter);
    expect(m.ok).toBe(false);
    expect(String(m.error)).toContain('没找到');
    expect(String(m.note)).toContain('地名库');
  });

  it('空查询 ⇒ 拒绝', async () => {
    expect((await searchPlace('')).ok).toBe(false);
  });
});
