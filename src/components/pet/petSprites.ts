/**
 * 桌宠资源约定（v1.85）
 *
 * 每个状态 = **一张透明 PNG**（不是 4 帧 spritesheet）：动画交给 CSS 变换，
 * 状态切换用淡入淡出。这样你画一张就能上一个状态，缺的会自动回落，不用等我改代码。
 *
 * 目录：public/pet/anya_<state>.png
 * 建议规格：320×400（或 512×640 更清晰）；角色**底部居中**、脚底基线一致；
 *          透明背景；留白一致（切状态不跳动）。
 */
export type PetSpriteState =
  | 'idle' | 'blink' | 'happy' | 'angry' | 'shocked' | 'sleepy'
  | 'peanut' | 'sit' | 'coffee' | 'reading'
  | 'sad' | 'talk' | 'walk' | 'wave' | 'think';

export interface PetSpriteDef {
  key: PetSpriteState;
  label: string;
  /** 缺这张图时回落到谁 */
  fallback: PetSpriteState;
}

export const PET_SPRITES: PetSpriteDef[] = [
  { key: 'idle', label: '待机微笑', fallback: 'idle' },
  { key: 'blink', label: '眨眼', fallback: 'idle' },
  { key: 'happy', label: '开心星星眼', fallback: 'idle' },
  { key: 'angry', label: '生气鼓脸', fallback: 'idle' },
  { key: 'shocked', label: '震惊张嘴', fallback: 'idle' },
  { key: 'sleepy', label: '困倦揉眼', fallback: 'idle' },
  { key: 'peanut', label: '吃花生', fallback: 'idle' },
  { key: 'sit', label: '坐下', fallback: 'idle' },
  { key: 'coffee', label: '喝咖啡', fallback: 'sit' },
  { key: 'reading', label: '读书', fallback: 'sit' },
  { key: 'sad', label: '低落', fallback: 'idle' },
  { key: 'talk', label: '说话', fallback: 'idle' },
  { key: 'walk', label: '行走', fallback: 'idle' },
  { key: 'wave', label: '挥手', fallback: 'happy' },
  { key: 'think', label: '思考', fallback: 'idle' },
];

export const PET_SPRITE_KEYS = PET_SPRITES.map(s => s.key);
export const PET_SPRITE_PATH = (state: PetSpriteState) => `/pet/anya_${state}.png`;

export function spriteLabel(state: PetSpriteState): string {
  return PET_SPRITES.find(s => s.key === state)?.label ?? state;
}

/** 缺图时的回落链（最多走 3 层，防环） */
export function fallbackChain(state: PetSpriteState): PetSpriteState[] {
  const out: PetSpriteState[] = [];
  let cur = state;
  for (let i = 0; i < 3; i++) {
    const def = PET_SPRITES.find(s => s.key === cur);
    if (!def) break;
    out.push(def.key);
    if (def.fallback === def.key) break;
    cur = def.fallback;
  }
  if (!out.includes('idle')) out.push('idle');
  return out;
}
