import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  VOICE_EVENTS_PATH,
  pumpVoiceEvents,
  voiceEventsAfter,
  voiceView,
  resetVoiceStateForTests,
  injectVoiceEvent,
} from '../voiceWatch.js';

let bak: string | null = null;

beforeEach(() => {
  bak = existsSync(VOICE_EVENTS_PATH) ? readFileSync(VOICE_EVENTS_PATH, 'utf8') : null;
  try { if (existsSync(VOICE_EVENTS_PATH)) unlinkSync(VOICE_EVENTS_PATH); } catch { /* ignore */ }
  const dir = dirname(VOICE_EVENTS_PATH);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  resetVoiceStateForTests();
});

afterEach(() => {
  if (bak !== null) writeFileSync(VOICE_EVENTS_PATH, bak, 'utf8');
  else { try { if (existsSync(VOICE_EVENTS_PATH)) unlinkSync(VOICE_EVENTS_PATH); } catch { /* ignore */ } }
  resetVoiceStateForTests();
});

describe('语音事件读取（v1.88）', () => {
  it('增量读取：第二次不重复返回同一行', () => {
    writeFileSync(VOICE_EVENTS_PATH, JSON.stringify({ ts: 1, kind: 'ready', text: '' }) + '\n', 'utf8');
    const first = pumpVoiceEvents();
    expect(first).toHaveLength(1);
    expect(first[0].kind).toBe('ready');
    expect(pumpVoiceEvents()).toHaveLength(0);
  });

  it('一次写入多行（wake + utterance）都能读到，seq 递增', () => {
    writeFileSync(VOICE_EVENTS_PATH, [
      JSON.stringify({ ts: 10, kind: 'wake', text: '安雅' }),
      JSON.stringify({ ts: 11, kind: 'utterance', text: '我今天有点累' }),
    ].join('\n') + '\n', 'utf8');
    const evs = pumpVoiceEvents();
    expect(evs.map(e => e.kind)).toEqual(['wake', 'utterance']);
    expect(evs[1].text).toBe('我今天有点累');
    expect(evs[1].seq).toBeGreaterThan(evs[0].seq);
  });

  it('坏行/未知 kind 被忽略，不影响其它行', () => {
    writeFileSync(VOICE_EVENTS_PATH, [
      'not json at all',
      JSON.stringify({ ts: 20, kind: 'bogus', text: 'x' }),
      JSON.stringify({ ts: 21, kind: 'no_speech', text: '' }),
    ].join('\n') + '\n', 'utf8');
    const evs = pumpVoiceEvents();
    expect(evs).toHaveLength(1);
    expect(evs[0].kind).toBe('no_speech');
  });

  it('ready 事件把 ready 置 true；error 置 false', () => {
    pumpVoiceEvents();
    injectVoiceEvent('ready', '');
    expect(voiceView().ready).toBe(true);
    injectVoiceEvent('error', 'mic failed');
    expect(voiceView().ready).toBe(false);
  });

  it('after 游标：只返回更新的事件（桌宠轮询用）', () => {
    const a = injectVoiceEvent('wake', '安雅');
    injectVoiceEvent('utterance', 'hello');
    expect(voiceEventsAfter(0)).toHaveLength(2);
    expect(voiceEventsAfter(a.seq)).toHaveLength(1);
    expect(voiceEventsAfter(999)).toHaveLength(0);
  });

  it('voiceView 反映开关状态与事件数（未启动时 running=false）', () => {
    delete process.env.ENABLE_VOICE_WAKE;
    expect(voiceView().enabled).toBe(false);
    expect(voiceView().running).toBe(false);
    process.env.ENABLE_VOICE_WAKE = 'true';
    expect(voiceView().enabled).toBe(true);
    delete process.env.ENABLE_VOICE_WAKE;
  });
});
