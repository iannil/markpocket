// Self-contained port of teable packages/core/src/models/field/color-utils.ts.
// Dropped the `color` npm dependency and teable-internal enum helpers; kept the
// helpers the color picker needs (hex lookup, random pick, palette).

import { Colors, rgbTuplesByColor } from './colors';

export interface IRGB {
  r: number;
  g: number;
  b: number;
}

function getRgbForColor(color: Colors): IRGB | null {
  const tuple = rgbTuplesByColor[color];
  return tuple ? { r: tuple[0], g: tuple[1], b: tuple[2] } : null;
}

export function getHexForColor(color: Colors): string | null {
  const rgb = getRgbForColor(color);
  if (!rgb) return null;
  const hex = (rgb.r << 16) | (rgb.g << 8) | rgb.b;
  return `#${hex.toString(16).padStart(6, '0')}`;
}

export function randomColor(exists: Colors[] = [], num = 1): Colors[] {
  const all = Object.values(Colors);
  let available = all.filter((c) => !exists.includes(c));
  const result: Colors[] = [];
  for (let i = 0; i < num; i++) {
    const pool = available.length > 0 ? available : all;
    const idx = Math.floor(Math.random() * pool.length);
    const picked = pool[idx]!;
    result.push(picked);
    if (available.length > 0) {
      available = available.filter((c) => c !== picked);
    }
  }
  return result;
}

// 5 groups of 10 (round-robin by index) — the layout the ColorPicker renders.
export function generateColorPalette(): Colors[][] {
  const colors = Object.values(Colors);
  const groupCount = 5;
  const result: Colors[][] = Array.from({ length: groupCount }, () => []);
  for (let i = 0; i < colors.length; i++) {
    const groupIndex = i % groupCount;
    const indexInGroup = Math.floor(i / groupCount);
    result[groupIndex]![indexInGroup] = colors[i]!;
  }
  return result;
}

export const COLOR_PALETTE = generateColorPalette();
