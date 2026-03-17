/**
 * Generate a 16x16 macOS menu bar template icon (iconTemplate.png).
 * Template images use black pixels with varying alpha for macOS to auto-tint.
 * Run with: npx tsx src/tray/generateIcon.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';

// 16x16 pixel art: small character silhouette (person at desk)
// 0 = transparent, 1 = black (full opacity)
const ICON = [
  '0000000110000000',
  '0000001111000000',
  '0000001111000000',
  '0000000110000000',
  '0000011111100000',
  '0000011111100000',
  '0000010110100000',
  '0000010000100000',
  '0000011001100000',
  '0000010000100000',
  '0000110001100000',
  '0000000000000000',
  '0011111111111100',
  '0011111111111100',
  '0010000000001100',
  '0010000000001100',
];

const SIZE = 16;
const png = new PNG({ width: SIZE, height: SIZE });

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const idx = (y * SIZE + x) * 4;
    const pixel = ICON[y][x] === '1' ? 1 : 0;
    png.data[idx + 0] = 0; // R - black for template
    png.data[idx + 1] = 0; // G
    png.data[idx + 2] = 0; // B
    png.data[idx + 3] = pixel ? 255 : 0; // A
  }
}

const outPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'iconTemplate.png');
const buffer = PNG.sync.write(png);
fs.writeFileSync(outPath, buffer);
console.log(`✓ Generated ${outPath} (${SIZE}×${SIZE})`);
