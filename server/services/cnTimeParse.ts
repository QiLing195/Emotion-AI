/**
 * 中文时间解析（v1.79）—— 把"下周三 / 明天下午三点 / 10月28日"变成具体时间戳。
 *
 * 为什么需要：让模型自己算"下周三还有几小时"实测会错（曾把"明天下午三点"算成 +3h，甚至 -5720h）。
 * 这里用确定性规则解析，`remember_this` / `set_followup` 在模型没给合法时间时用它兜底。
 *
 * 只覆盖常见说法；解析不出来就返回 null（由调用方如实说"没听懂时间"，绝不猜）。
 */

const WEEKDAY: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0,
  1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 0,
};

export interface ParsedTime {
  dueAt: number;
  matched: string;
  /** 人话确认，便于回灌给她/给日志 */
  human: string;
}

function atLocal(now: number, addDays: number, hour: number, minute = 0): number {
  const d = new Date(now);
  d.setDate(d.getDate() + addDays);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

function fmt(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 时段词 → 默认小时 */
function hourOfPeriod(period: string | undefined, explicitHour: number | undefined): number {
  const p = period ?? '';
  const isPM = /下午|傍晚|晚上|夜里|晚/.test(p);
  const isNoon = /中午/.test(p);
  const isAM = /早上|上午|清晨/.test(p);
  if (typeof explicitHour === 'number') {
    if (isPM && explicitHour < 12) return explicitHour + 12;
    if (isNoon && explicitHour < 12) return explicitHour === 12 ? 12 : explicitHour + 12;
    if (isAM && explicitHour === 12) return 0;
    return explicitHour;
  }
  if (isNoon) return 12;
  if (isPM) return 19;
  if (isAM) return 9;
  return 10;                                     // 只说了哪一天 → 默认上午 10 点
}

/** 把"下周三下午三点""明天上午 10 点""10月28日"解析成时间戳；解析不了返回 null */
export function parseCnTime(text: string, now: number = Date.now()): ParsedTime | null {
  const s = String(text ?? '');
  if (!s) return null;

  // 时段 + 小时（例：下午三点 / 晚上8点 / 上午 10:30）
  const periodMatch = s.match(/(早上|上午|清晨|中午|下午|傍晚|晚上|夜里|晚)/);
  const period = periodMatch?.[1];
  const hourMatch = s.match(/(\d{1,2})\s*[:：]\s*(\d{1,2})/);
  let explicitHour: number | undefined;
  let explicitMinute = 0;
  if (hourMatch) {
    explicitHour = Number(hourMatch[1]);
    explicitMinute = Number(hourMatch[2]);
  } else {
    const cnHour = s.match(/([零一二两三四五六七八九十]{1,3})\s*点/);
    if (cnHour) {
      const map: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
      const v = map[cnHour[1]];
      if (typeof v === 'number') explicitHour = v;
    } else {
      const numHour = s.match(/(\d{1,2})\s*点/);
      if (numHour) explicitHour = Number(numHour[1]);
    }
  }

  // ① 绝对日期：10月28日 / 2026-10-28
  const abs = s.match(/(?:(\d{4})[-/年])?(\d{1,2})[-/月](\d{1,2})[日号]?/);
  if (abs) {
    const y = abs[1] ? Number(abs[1]) : new Date(now).getFullYear();
    const mo = Number(abs[2]);
    const day = Number(abs[3]);
    if (mo >= 1 && mo <= 12 && day >= 1 && day <= 31) {
      const hour = hourOfPeriod(period, explicitHour);
      const d = new Date(y, mo - 1, day, hour, explicitMinute, 0, 0);
      let ts = d.getTime();
      if (!abs[1] && ts < now - 60_000) {         // 没写年份且已过 → 明年
        const d2 = new Date(y + 1, mo - 1, day, hour, explicitMinute, 0, 0);
        ts = d2.getTime();
      }
      return { dueAt: ts, matched: abs[0], human: fmt(ts) };
    }
  }

  // ② 相对日：今天/明天/后天/大后天
  const rel = s.match(/(今天|明天|后天|大后天)/);
  if (rel) {
    const addDays = rel[1] === '今天' ? 0 : rel[1] === '明天' ? 1 : rel[1] === '后天' ? 2 : 3;
    let ts = atLocal(now, addDays, hourOfPeriod(period, explicitHour), explicitMinute);
    if (ts < now - 60_000) ts = atLocal(now, addDays + 1, hourOfPeriod(period, explicitHour), explicitMinute);
    return { dueAt: ts, matched: rel[1], human: fmt(ts) };
  }

  // ③ 星期：下周三 / 周三 / 星期日
  const wk = s.match(/(下下|下|这|本)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天1-7])/);
  if (wk) {
    const prefix = wk[1] ?? '';
    const target = WEEKDAY[wk[2]];
    if (typeof target === 'number') {
      const today = new Date(now).getDay();
      let diff = (target - today + 7) % 7;
      if (prefix === '下下') diff += 14;
      else if (prefix === '下') diff += 7;
      else if (diff === 0) diff = 7;              // 只写"周三"且今天正好周三 ⇒ 指下一个周三
      const ts = atLocal(now, diff, hourOfPeriod(period, explicitHour), explicitMinute);
      return { dueAt: ts, matched: wk[0].trim(), human: fmt(ts) };
    }
  }

  // ④ 只有时段（"下午三点"）⇒ 今天/明天最近的那个点
  if (explicitHour !== undefined) {
    let ts = atLocal(now, 0, hourOfPeriod(period, explicitHour), explicitMinute);
    if (ts < now) ts = atLocal(now, 1, hourOfPeriod(period, explicitHour), explicitMinute);
    return { dueAt: ts, matched: (period ?? '') + String(explicitHour), human: fmt(ts) };
  }

  return null;
}

/** 把时间戳格式化成 set_followup 需要的本地时间字符串（YYYY-MM-DDTHH:mm） */
export function toLocalIso(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
