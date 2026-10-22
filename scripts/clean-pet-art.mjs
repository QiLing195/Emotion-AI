// 把 public/pet/anya_*.png 里"伪装成 PNG 的 JPEG + 棋盘格背景"处理成真·透明 PNG。
//
// 做法：从四边做连通域泛洪，把"亮且灰"（棋盘格的白/灰方块）判为背景 → alpha=0；
// 只从边界扩散，所以被角色描边围住的白色（袜子、开衫、鞋子）不会被误删。
//
// 用法：node scripts/clean-pet-art.mjs
import sharp from 'sharp';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const DIR = path.join('public', 'pet');
const OUT_W = 512;
const OUT_H = 640;

/**
 * 棋盘格有两种明度（浅格/深格），而且不同图的两档不一样（sad 那张深格明显更暗）。
 * 所以先从边框采样，估计这两档灰度，再按"接近这两档 + 纯灰"判定背景。
 */
function buildBgMatcher(px, width, height) {
  const grays = [];
  const sample = (x, y) => {
    const o = (y * width + x) * 4;
    const r = px[o], g = px[o + 1], b = px[o + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) <= 16) grays.push((r + g + b) / 3);
  };
  for (let x = 0; x < width; x += 2) { sample(x, 1); sample(x, height - 2); }
  for (let y = 0; y < height; y += 2) { sample(1, y); sample(width - 2, y); }
  grays.sort((a, b) => a - b);
  const q = (p) => grays[Math.min(grays.length - 1, Math.max(0, Math.floor(p * (grays.length - 1))))] ?? 200;
  const c1 = q(0.15);                       // 深格
  const c2 = q(0.85);                       // 浅格
  // 只要"纯灰 + 比深格还亮"就算背景：这样两档灰度、以及两档之间的压缩过渡色都能吃掉
  const floor = Math.min(c1, c2) - 25;
  return (r, g, b) => {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min > 14) return false;       // 非纯灰（肤色/衣服颜色）不算背景
    return (r + g + b) / 3 >= floor;
  };
}

async function cleanOne(file) {
  const input = path.join(DIR, file);
  const st = await stat(input);
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const px = data; // RGBA
  const isBgPixel = buildBgMatcher(px, width, height);
  const visited = new Uint8Array(width * height);
  const stack = [];

  const pushIfBg = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const idx = y * width + x;
    if (visited[idx]) return;
    visited[idx] = 1;
    const o = idx * 4;
    if (isBgPixel(px[o], px[o + 1], px[o + 2])) stack.push(idx);
  };

  for (let x = 0; x < width; x++) { pushIfBg(x, 0); pushIfBg(x, height - 1); }
  for (let y = 0; y < height; y++) { pushIfBg(0, y); pushIfBg(width - 1, y); }

  while (stack.length) {
    const idx = stack.pop();
    const o = idx * 4;
    px[o + 3] = 0;
    const x = idx % width;
    const y = (idx - x) / width;
    pushIfBg(x - 1, y); pushIfBg(x + 1, y); pushIfBg(x, y - 1); pushIfBg(x, y + 1);
  }

  // 1) 边缘晕色清理：紧贴透明区、偏灰且不暗的像素（肤色混进棋盘格的那些斑）逐圈清掉
  for (let pass = 0; pass < 3; pass++) {
    const toClear = [];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const o = idx * 4;
        if (px[o + 3] === 0) continue;
        const nearTransparent =
          px[((y - 1) * width + x) * 4 + 3] === 0 ||
          px[((y + 1) * width + x) * 4 + 3] === 0 ||
          px[(y * width + x - 1) * 4 + 3] === 0 ||
          px[(y * width + x + 1) * 4 + 3] === 0;
        if (!nearTransparent) continue;
        const max = Math.max(px[o], px[o + 1], px[o + 2]);
        const min = Math.min(px[o], px[o + 1], px[o + 2]);
        const g0 = (px[o] + px[o + 1] + px[o + 2]) / 3;
        if (max - min <= 30 && g0 >= 118) toClear.push(idx);
      }
    }
    for (const idx of toClear) px[idx * 4 + 3] = 0;
  }

  // 2) 孤立噪点：完全被透明包住、面积很小且偏灰亮的连通块，直接清掉
  {
    const seen = new Uint8Array(width * height);
    const stack2 = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (seen[idx]) continue;
        seen[idx] = 1;
        if (px[idx * 4 + 3] === 0) continue;
        const comp = [idx];
        const gray = [];
        stack2.length = 0;
        stack2.push(idx);
        let touchesBorder = false;
        while (stack2.length) {
          const cur = stack2.pop();
          const cx = cur % width;
          const cy = (cur - cx) / width;
          if (cx === 0 || cy === 0 || cx === width - 1 || cy === height - 1) touchesBorder = true;
          for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const nidx = ny * width + nx;
            if (seen[nidx]) continue;
            seen[nidx] = 1;
            if (px[nidx * 4 + 3] === 0) continue;
            comp.push(nidx);
            stack2.push(nidx);
          }
        }
        if (touchesBorder || comp.length > 90) continue;
        for (const c2 of comp) {
          const o = c2 * 4;
          gray.push((px[o] + px[o + 1] + px[o + 2]) / 3);
        }
        const avg = gray.reduce((a, b) => a + b, 0) / gray.length;
        if (avg >= 120) for (const c2 of comp) px[c2 * 4 + 3] = 0;
      }
    }
  }

  // 统计：透明占比 + 计算内容包围盒（用来确认角色位置/基线一致性）
  let transparent = 0;
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = px[(y * width + x) * 4 + 3];
      if (a === 0) { transparent++; continue; }
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  await sharp(px, { raw: { width, height, channels: 4 } })
    .resize(OUT_W, OUT_H, { fit: 'fill' })
    .png({ compressionLevel: 9 })
    .toFile(input + '.tmp.png');

  // 原子替换
  const { rename } = await import('node:fs/promises');
  await rename(input + '.tmp.png', input);

  return {
    file,
    src: `${width}x${height}`,
    kb: Math.round(st.size / 1024),
    transparentPct: Math.round((transparent / (width * height)) * 100),
    bbox: `${minX},${minY} - ${maxX},${maxY}`,
    bottomGap: height - 1 - maxY,
  };
}

const files = (await readdir(DIR)).filter(f => /^anya_.*\.png$/.test(f)).sort();
console.log(`处理 ${files.length} 张 → ${OUT_W}x${OUT_H} 透明 PNG\n`);
for (const f of files) {
  try {
    const r = await cleanOne(f);
    console.log(
      `${r.file.padEnd(20)} ${r.src.padEnd(9)} ${String(r.kb).padStart(4)}KB → 透明 ${String(r.transparentPct).padStart(2)}%  bbox ${r.bbox.padEnd(18)} 脚底留白 ${r.bottomGap}px`
    );
  } catch (e) {
    console.error(`${f} 失败: ${e.message}`);
  }
}
