import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PET_DIR = path.join(ROOT, 'public', 'pet');
const EXPECTED_WIDTH = 512;
const EXPECTED_HEIGHT = 640;
const MAX_FILE_BYTES = 1_000_000;
const ALPHA_THRESHOLD = 12;
const failures = [];
let checksRun = 0;
const report = (ok, message) => {
  checksRun += 1;
  if (!ok) {
    console.error(`FAIL ${message}`);
    failures.push(message);
  }
};

const files = (await fs.readdir(PET_DIR))
  .filter(name => /^anya_.+\.png$/i.test(name))
  .sort();
const assets = new Map();

if (files.length === 0) {
  console.error(`No pet PNG assets found in ${PET_DIR}`);
  process.exit(1);
}

for (const name of files) {
  const filePath = path.join(PET_DIR, name);
  const [metadata, stat] = await Promise.all([sharp(filePath).metadata(), fs.stat(filePath)]);
  const validPng = metadata.format === 'png';
  report(validPng, `${name}: PNG format`);
  report(metadata.hasAlpha === true, `${name}: alpha channel`);
  report(metadata.width === EXPECTED_WIDTH && metadata.height === EXPECTED_HEIGHT,
    `${name}: ${metadata.width}x${metadata.height} (expected ${EXPECTED_WIDTH}x${EXPECTED_HEIGHT})`);
  report(stat.size <= MAX_FILE_BYTES, `${name}: ${stat.size} bytes (limit ${MAX_FILE_BYTES})`);

  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] <= ALPHA_THRESHOLD) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const hasVisiblePixels = maxX >= minX && maxY >= minY;
  report(hasVisiblePixels, `${name}: non-empty visible bounds`);
  const corners = [0, info.width - 1, (info.height - 1) * info.width, info.height * info.width - 1];
  const transparentCorners = corners.every(index => data[index * 4 + 3] <= ALPHA_THRESHOLD);
  report(transparentCorners, `${name}: transparent canvas corners`);
  if (hasVisiblePixels) {
    assets.set(name, {
      width: metadata.width,
      height: metadata.height,
      bounds: { minX, minY, maxX, maxY },
    });
  }
}

const compareBounds = (leftName, rightName, tolerance, label) => {
  const left = assets.get(leftName)?.bounds;
  const right = assets.get(rightName)?.bounds;
  if (!left || !right) {
    report(false, `${label}: missing paired asset (${leftName}, ${rightName})`);
    return;
  }
  const leftCenterX = (left.minX + left.maxX) / 2;
  const rightCenterX = (right.minX + right.maxX) / 2;
  const leftHeight = left.maxY - left.minY;
  const rightHeight = right.maxY - right.minY;
  const checks = {
    centerX: Math.abs(leftCenterX - rightCenterX) <= tolerance.centerX,
    top: Math.abs(left.minY - right.minY) <= tolerance.top,
    baseline: Math.abs(left.maxY - right.maxY) <= tolerance.baseline,
    height: Math.abs(leftHeight - rightHeight) <= tolerance.height,
  };
  report(Object.values(checks).every(Boolean), `${label}: center/top/baseline/height within tolerance`);
};

const sequences = new Map();
for (const name of files) {
  const match = /^anya_(.+)_(\d+)\.png$/i.exec(name);
  if (!match) continue;
  const [, state, frameText] = match;
  const frame = Number(frameText);
  if (!sequences.has(state)) sequences.set(state, []);
  sequences.get(state).push({ name, frame });
}

for (const [state, frames] of sequences) {
  frames.sort((a, b) => a.frame - b.frame);
  report(frames.every((entry, index) => entry.frame === index + 1), `${state}: frame numbering is contiguous from 1`);
  for (let index = 1; index < frames.length; index += 1) {
    compareBounds(frames[index - 1].name, frames[index].name,
      { centerX: 12, top: 5, baseline: 5, height: 8 }, `${state} frame ${index}→${index + 1}`);
  }
}

for (const [base, blink] of [
  ['anya_idle.png', 'anya_blink.png'],
  ['anya_coffee.png', 'anya_coffee_blink.png'],
  ['anya_reading.png', 'anya_reading_blink.png'],
]) {
  compareBounds(base, blink, { centerX: 10, top: 6, baseline: 6, height: 10 }, `${base} ↔ blink`);
}

console.log(`Validated ${checksRun} checks across ${files.length} pet PNG assets.`);
if (failures.length > 0) {
  console.error(`${failures.length} validation issue(s) found.`);
  process.exitCode = 1;
} else {
  console.log('All pet asset checks passed.');
}
