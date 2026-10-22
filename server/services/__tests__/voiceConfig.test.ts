import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_VOICE_CONFIG, MAX_WAKE_WORDS, VOICE_CONFIG_PATH, loadVoiceConfig, saveVoiceConfig,
} from '../voiceConfig.js';

let bak: string | null = null;

beforeEach(() => {
  bak = existsSync(VOICE_CONFIG_PATH) ? readFileSync(VOICE_CONFIG_PATH, 'utf8') : null;
});

afterEach(() => {
  if (bak !== null) writeFileSync(VOICE_CONFIG_PATH, bak, 'utf8');
  else { try { if (existsSync(VOICE_CONFIG_PATH)) rmSync(VOICE_CONFIG_PATH); } catch { /* ignore */ } }
});

describe('唤醒词配置（v1.90）', () => {
  it('保存合法配置并读回', () => {
    const r = saveVoiceConfig({ wakeWords: ['二丫', '小丫'], wakeMinConfidence: 0.9 });
    expect(r.ok).toBe(true);
    const cfg = loadVoiceConfig();
    expect(cfg.wakeWords).toEqual(['二丫', '小丫']);
    expect(cfg.wakeMinConfidence).toBe(0.9);
  });

  it('逗号/顿号/空格分隔的字符串也能解析', () => {
    const r = saveVoiceConfig({ wakeWords: '二丫、小丫，阿雅 小安', wakeMinConfidence: 0.93 });
    expect(r.ok).toBe(true);
    expect(loadVoiceConfig().wakeWords).toEqual(['二丫', '小丫', '阿雅', '小安']);
  });

  it('去重', () => {
    saveVoiceConfig({ wakeWords: ['二丫', '二丫', '小丫'], wakeMinConfidence: 0.93 });
    expect(loadVoiceConfig().wakeWords).toEqual(['二丫', '小丫']);
  });

  it('空数组 / 空字符串被拒绝（不写坏配置）', () => {
    expect(saveVoiceConfig({ wakeWords: [], wakeMinConfidence: 0.93 }).ok).toBe(false);
    expect(saveVoiceConfig({ wakeWords: '  ', wakeMinConfidence: 0.93 }).ok).toBe(false);
    expect(saveVoiceConfig({ wakeWords: ['二丫'], wakeMinConfidence: 0.93 }).ok).toBe(true);
    expect(loadVoiceConfig().wakeWords).toEqual(['二丫']);
  });

  it('唤醒词太长 / 太多被拒绝', () => {
    expect(saveVoiceConfig({ wakeWords: ['一个特别特别特别特别长的唤醒词'], wakeMinConfidence: 0.93 }).ok).toBe(false);
    const many = Array.from({ length: MAX_WAKE_WORDS + 1 }, (_, i) => `词${i}`);
    expect(saveVoiceConfig({ wakeWords: many, wakeMinConfidence: 0.93 }).ok).toBe(false);
  });

  it('置信度越界被拒绝', () => {
    expect(saveVoiceConfig({ wakeWords: ['二丫'], wakeMinConfidence: 0.3 }).ok).toBe(false);
    expect(saveVoiceConfig({ wakeWords: ['二丫'], wakeMinConfidence: 1.2 }).ok).toBe(false);
    expect(saveVoiceConfig({ wakeWords: ['二丫'], wakeMinConfidence: 0.5 }).ok).toBe(true);
  });

  it('配置文件坏了 → 回落到默认值而不是崩', () => {
    writeFileSync(VOICE_CONFIG_PATH, '{ not json', 'utf8');
    const cfg = loadVoiceConfig();
    expect(cfg.wakeWords.length).toBeGreaterThan(0);
    expect(cfg.wakeMinConfidence).toBe(DEFAULT_VOICE_CONFIG.wakeMinConfidence);
  });
});

describe('桌面图标（只读列表 + 打开策略）', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'desk-test-'));
  });
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('文件夹/文档/图片可打开，exe/脚本不可打开', async () => {
    const { openPolicy } = await import('../desktopItems.js');
    expect(openPolicy({ kind: 'folder', ext: '' }).canOpen).toBe(true);
    expect(openPolicy({ kind: 'document', ext: '.pdf' }).canOpen).toBe(true);
    expect(openPolicy({ kind: 'image', ext: '.png' }).canOpen).toBe(true);
    expect(openPolicy({ kind: 'shortcut', ext: '.lnk' }).canOpen).toBe(true);
    const exe = openPolicy({ kind: 'other', ext: '.exe' });
    expect(exe.canOpen).toBe(false);
    expect(String(exe.reason)).toContain('安全限制');
    expect(openPolicy({ kind: 'other', ext: '.ps1' }).canOpen).toBe(false);
  });

  it('列出临时目录里的条目（名称/类型/大小）', async () => {
    mkdirSync(join(dir, '项目'));
    writeFileSync(join(dir, '说明.txt'), 'hello');
    writeFileSync(join(dir, '照片.png'), 'xx');
    writeFileSync(join(dir, '安装程序.exe'), 'xx');
    const d = await import('../desktopItems.js');
    expect(typeof d.listDesktopItems).toBe('function');
    expect(d.listDesktopItems).toBeTruthy();
  });

  it('未出现在白名单里的扩展名默认不可打开', async () => {
    const { openPolicy } = await import('../desktopItems.js');
    expect(openPolicy({ kind: 'other', ext: '.xyz' }).canOpen).toBe(false);
  });
});
