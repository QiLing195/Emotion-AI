import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { buildPetTrayMenuTemplate } = require('../petTrayMenu.cjs') as {
  buildPetTrayMenuTemplate: (actions: {
    focusPet: () => void;
    reloadPet: () => void;
    openChat: () => void;
    openVoiceSettings: () => void;
    quit: () => void;
  }) => Array<{ label?: string; type?: string; click?: () => void }>;
};

describe('pet tray recovery menu', () => {
  it('exposes focus and manual renderer recovery without requiring renderer IPC', () => {
    const called: string[] = [];
    const template = buildPetTrayMenuTemplate({
      focusPet: () => called.push('focus'),
      reloadPet: () => called.push('reload'),
      openChat: () => called.push('chat'),
      openVoiceSettings: () => called.push('voice'),
      quit: () => called.push('quit'),
    });

    template.find((item) => item.label === '显示桌宠')?.click?.();
    template.find((item) => item.label === '重载桌宠界面')?.click?.();

    expect(called).toEqual(['focus', 'reload']);
  });
});
