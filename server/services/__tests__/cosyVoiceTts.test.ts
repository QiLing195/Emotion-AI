// ── cosyVoiceTts 单元测试（v1.6 双端点 + 情绪强度 + WAV 封装）──
// 必须锁死的行为：
//  ① 优先用带 speed 的增强端点 /tts；官方 server 返回 404/405 → 回退 /inference_instruct2
//  ② 回退后**只丢语速**，情绪指令与文本必须照常带上（不能静默退回中性语气）
//  ③ 端点探测结果被缓存 —— 回退后不再每次撞 404
//  ④ 连不上服务 → CosyVoiceUnavailableError（前端据此回退浏览器语音）
//  ⑤ 返回的是合法 WAV（前 4 字节 RIFF），而不是裸 PCM

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import {
  pcmToWav,
  promptWavPath,
  promptWavForTimbre,
  synthesizeCosyVoice,
  synthesizeCosyVoiceArc,
  cosyVoiceHealth,
  CosyVoiceUnavailableError,
  __resetEndpointCache,
  COSYVOICE_SAMPLE_RATE,
} from '../cosyVoiceTts';
import { cosyVoiceInstruct } from '../../../src/lib/voiceTone';

/** 造一段足够长的假 PCM（长度需 > 1000 字节，否则被判"音频过短"） */
function fakePcm(bytes = 4096): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

interface Call {
  url: string;
  body: FormData;
}

/** 记录每次 fetch 的 url + form 字段，按脚本返回状态码 */
function mockFetch(script: Array<{ status: number; body?: ArrayBuffer }>): Call[] {
  const calls: Call[] = [];
  let i = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
    calls.push({ url, body: init.body as FormData });
    const step = script[Math.min(i, script.length - 1)];
    i += 1;
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      arrayBuffer: async () => step.body ?? fakePcm(),
    } as unknown as Response;
  }));
  return calls;
}

const formEntries = (form: FormData): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) out[k] = typeof v === 'string' ? v : '<file>';
  return out;
};

beforeEach(() => {
  __resetEndpointCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('pcmToWav — 裸 PCM 补 WAV 头（浏览器 <audio> 必需）', () => {
  it('写出合法的 RIFF/WAVE 头与正确长度', () => {
    const pcm = Buffer.alloc(1000, 7);
    const wav = pcmToWav(pcm);
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(wav.subarray(12, 16).toString('ascii')).toBe('fmt ');
    expect(wav.subarray(36, 40).toString('ascii')).toBe('data');
    expect(wav.readUInt32LE(4)).toBe(36 + pcm.length);
    expect(wav.readUInt32LE(24)).toBe(COSYVOICE_SAMPLE_RATE);
    expect(wav.readUInt16LE(22)).toBe(1);   // mono
    expect(wav.readUInt16LE(34)).toBe(16);  // 16-bit
    expect(wav.readUInt32LE(40)).toBe(pcm.length);
    expect(wav.length).toBe(44 + pcm.length);
    expect(wav.subarray(44)).toEqual(pcm);
  });
});

describe('synthesizeCosyVoice — 增强端点优先', () => {
  it('首选 /tts，并带上 text/mode/instruct_text/speed', async () => {
    const calls = mockFetch([{ status: 200 }]);
    const wav = await synthesizeCosyVoice({ text: '你好呀', emotion: 'joy', intensity: 0.9 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/tts');
    const fields = formEntries(calls[0].body);
    expect(fields.text).toBe('你好呀');
    expect(fields.mode).toBe('instruct2');
    expect(fields.instruct_text).toBe(cosyVoiceInstruct('joy', 0.9));
    expect(Number(fields.speed)).toBeGreaterThan(1);
    expect(fields.prompt_wav).toBe('<file>');
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
  });

  it('情绪强度进入指令：高强度用强化档，低强度用温和档', async () => {
    let calls = mockFetch([{ status: 200 }]);
    await synthesizeCosyVoice({ text: 'x', emotion: 'joy', intensity: 0.9 });
    const strong = formEntries(calls[0].body).instruct_text;

    __resetEndpointCache();
    calls = mockFetch([{ status: 200 }]);
    await synthesizeCosyVoice({ text: 'x', emotion: 'joy', intensity: 0.05 });
    const mild = formEntries(calls[0].body).instruct_text;

    expect(strong).not.toBe(mild);
    expect(strong).toContain('非常开心');
    expect(mild).not.toContain('非常开心');
  });
});

describe('synthesizeCosyVoice — 官方 server 回退', () => {
  it('/tts 返回 404 → 回退 /inference_instruct2，且情绪指令不丢', async () => {
    const calls = mockFetch([{ status: 404 }, { status: 200 }]);
    const wav = await synthesizeCosyVoice({ text: '你好呀', emotion: 'sad', intensity: 0.8 });

    expect(calls.map(c => c.url)).toHaveLength(2);
    expect(calls[0].url).toContain('/tts');
    expect(calls[1].url).toContain('/inference_instruct2');

    const fallback = formEntries(calls[1].body);
    expect(fallback.tts_text).toBe('你好呀');           // 官方端点字段名是 tts_text
    expect(fallback.instruct_text).toBe(cosyVoiceInstruct('sad', 0.8));
    expect(fallback.instruct_text).toContain('伤心');    // 关键：不能静默退回中性语气
    expect(fallback.speed).toBeUndefined();              // 只丢语速
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
  });

  it('405 同样触发回退', async () => {
    const calls = mockFetch([{ status: 405 }, { status: 200 }]);
    await synthesizeCosyVoice({ text: 'hi' });
    expect(calls[1].url).toContain('/inference_instruct2');
  });

  it('回退后缓存官方端点：后续合成不再撞 404', async () => {
    const first = mockFetch([{ status: 404 }, { status: 200 }]);
    await synthesizeCosyVoice({ text: 'a' });
    expect(first).toHaveLength(2);

    const second = mockFetch([{ status: 200 }]);
    await synthesizeCosyVoice({ text: 'b' });
    expect(second).toHaveLength(1);
    expect(second[0].url).toContain('/inference_instruct2');
  });
});

describe('synthesizeCosyVoice — 失败路径', () => {
  it('服务连不上 → CosyVoiceUnavailableError，且不再试第二个端点', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    vi.stubGlobal('fetch', fetchMock);
    await expect(synthesizeCosyVoice({ text: 'hi' })).rejects.toBeInstanceOf(CosyVoiceUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('HTTP 500 → 抛错（不静默返回空音频）', async () => {
    mockFetch([{ status: 500 }]);
    await expect(synthesizeCosyVoice({ text: 'hi' })).rejects.toThrow(/HTTP 500/);
  });

  it('返回音频过短 → 抛错（防把错误响应当音频播）', async () => {
    mockFetch([{ status: 200, body: new Uint8Array(10).buffer }]);
    await expect(synthesizeCosyVoice({ text: 'hi' })).rejects.toThrow(/过短/);
  });

  it('空文本 → 直接拒绝，不发请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(synthesizeCosyVoice({ text: '   ' })).rejects.toThrow(/empty text/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('参考音缺失 → 明确报错（便于排查而不是静默失败）', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    await expect(synthesizeCosyVoice({ text: 'hi' })).rejects.toThrow(/参考音缺失/);
    vi.restoreAllMocks();
  });
});

describe('cosyVoiceHealth', () => {
  it('探测失败返回 false（不抛错，不影响主流程）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('nope'); }));
    expect(await cosyVoiceHealth(50)).toBe(false);
  });

  it('探测成功返回 true', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true }) as unknown as Response));
    expect(await cosyVoiceHealth(50)).toBe(true);
  });
});

// ── v1.11 句内状态弧线：逐段合成 + 后段以前段音频为参考音 ──
describe('synthesizeCosyVoiceArc — 句内状态弧线', () => {
  const seg = (text: string, speed: number, timbre: 'default' | 'dark' = 'default') => ({
    text,
    performance: { instruct: `You are a helpful assistant. ${text}<|endofprompt|>`, speed, timbre, drivers: [] },
  });

  it('逐段合成，且第 k(>1) 段用**前一段的音频**当参考音（flow 侧延续）', async () => {
    const calls = mockFetch([{ status: 200 }, { status: 200 }]);
    const wav = await synthesizeCosyVoiceArc({
      segments: [seg('我今天有点累，', 0.94, 'dark'), seg('不过看到你的消息就好多了。', 1.0, 'dark')],
    });
    expect(calls).toHaveLength(2);
    expect(formEntries(calls[0].body).instruct_text).toContain('我今天有点累');
    expect(formEntries(calls[1].body).instruct_text).toContain('不过看到你的消息');
    // 两次用的参考音**不是同一个文件**：第二段是刚生成的第一段音频（长度不同即可区分）
    const first = (calls[0].body.get('prompt_wav') as File).size;
    const second = (calls[1].body.get('prompt_wav') as File).size;
    expect(second).not.toBe(first);
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
  });

  it('每段用各自的语速（弧线两端的语气不同）', async () => {
    const calls = mockFetch([{ status: 200 }, { status: 200 }]);
    await synthesizeCosyVoiceArc({ segments: [seg('前半。', 0.9), seg('后半。', 1.12)] });
    expect(Number(formEntries(calls[0].body).speed)).toBeCloseTo(0.9, 5);
    expect(Number(formEntries(calls[1].body).speed)).toBeCloseTo(1.12, 5);
  });

  it('拼出来的音频比任一段都长（确实拼接了，而不是丢掉后段）', async () => {
    mockFetch([{ status: 200 }, { status: 200 }]);   // ⚠️ 必须打桩，否则会真的打到本机 TTS 服务
    const wav = await synthesizeCosyVoiceArc({ segments: [seg('前半。', 1), seg('后半。', 1)] });
    expect(wav.length).toBeGreaterThan(44 + 4096);   // 至少两段各 2048 采样
  });

  it('只有一段时退化为普通单次合成', async () => {
    const calls = mockFetch([{ status: 200 }]);
    await synthesizeCosyVoiceArc({ segments: [seg('只有一句。', 1)] });
    expect(calls).toHaveLength(1);
  });

  it('空段列表 → 抛错（调用方据此回退单次整句）', async () => {
    await expect(synthesizeCosyVoiceArc({ segments: [] })).rejects.toBeInstanceOf(CosyVoiceUnavailableError);
    await expect(synthesizeCosyVoiceArc({ segments: [{ text: '   ', performance: seg('x', 1).performance }] }))
      .rejects.toBeInstanceOf(CosyVoiceUnavailableError);
  });

  it('中间段失败 → 抛错，由调用方回退（绝不返回半截音频）', async () => {
    mockFetch([{ status: 200 }, { status: 500 }]);
    await expect(synthesizeCosyVoiceArc({ segments: [seg('前半。', 1), seg('后半。', 1)] }))
      .rejects.toBeInstanceOf(CosyVoiceUnavailableError);
  });
});

describe('promptWavPath — 默认参考音（官方默认女声，用户已选定）', () => {
  it('指向 server/assets/voice_prompt.wav 且文件真实存在', () => {
    const p = promptWavPath();
    expect(p.replace(/\\/g, '/')).toMatch(/server\/assets\/voice_prompt\.wav$/);
    expect(fs.existsSync(p)).toBe(true);
  });
});

// ── v1.9 状态驱动的发声：音色选择 + 发声结果透传 ──
describe('promptWavForTimbre — 音色 → 参考音', () => {
  it('dark 走暗音色参考音，且该资产真实存在', () => {
    const p = promptWavForTimbre('dark');
    expect(p.replace(/\\/g, '/')).toMatch(/voice_prompt_dark\.wav$/);
    expect(fs.existsSync(p)).toBe(true);
  });

  it('default 走官方默认女声', () => {
    expect(promptWavForTimbre('default')).toBe(promptWavPath());
  });

  it('暗音色资产缺失时静默回退默认（少一份文件不该让 TTS 报错）', () => {
    const exists = fs.existsSync;
    vi.spyOn(fs, 'existsSync').mockImplementation((p: any) =>
      String(p).includes('voice_prompt_dark') ? false : exists(p));
    expect(promptWavForTimbre('dark')).toBe(promptWavPath());
    vi.restoreAllMocks();
  });
});

describe('synthesizeCosyVoice — 状态驱动的发声结果', () => {
  it('传了 performance 就用它的指令与语速（含按音色切参考音）', async () => {
    const calls = mockFetch([{ status: 200 }]);
    await synthesizeCosyVoice({
      text: '我在呢',
      performance: {
        instruct: 'You are a helpful assistant. 测试指令，声音发闷。<|endofprompt|>',
        speed: 0.92,
        timbre: 'dark',
        drivers: ['valence:dark'],
      },
    });
    const fields = formEntries(calls[0].body);
    expect(fields.instruct_text).toContain('测试指令');
    expect(fields.instruct_text).toContain('声音发闷');
    expect(Number(fields.speed)).toBeCloseTo(0.92, 5);
    // 表单里送的参考音应来自暗音色文件（两份资产字节数不同，可据此区分）
    const darkLen = fs.statSync(promptWavForTimbre('dark')).size;
    const defLen = fs.statSync(promptWavPath()).size;
    const sent = (calls[0].body.get('prompt_wav') as File).size;
    expect(darkLen).not.toBe(defLen);
    expect(sent).toBe(darkLen);
  });

  it('没传 performance 时退回"情绪标签 + 强度"的老行为（向后兼容）', async () => {
    const calls = mockFetch([{ status: 200 }]);
    await synthesizeCosyVoice({ text: '你好', emotion: 'joy', intensity: 0.9 });
    const fields = formEntries(calls[0].body);
    expect(fields.instruct_text).toBe(cosyVoiceInstruct('joy', 0.9));
    expect(Number(fields.speed)).toBeGreaterThan(1);
  });
});
