import type { Rgb } from '../model';

export type GroupColor = 'grey' | 'blue' | 'red' | 'yellow' | 'green' | 'pink' | 'purple' | 'cyan' | 'orange';

// Hue (degrees) each Chrome tab group color reads as; red appears twice to wrap around 360.
const HUES: [number, GroupColor][] = [
  [0, 'red'], [30, 'orange'], [55, 'yellow'], [120, 'green'], [185, 'cyan'],
  [225, 'blue'], [275, 'purple'], [320, 'pink'], [360, 'red'],
];

/** Nearest Chrome tab group color for an Arc space color (0–255 channels). */
export function nearestGroupColor(rgb: Rgb | undefined): GroupColor {
  if (!rgb) return 'grey';
  const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
  const max = Math.max(r, g, b), delta = max - Math.min(r, g, b);
  if (max === 0 || delta / max < 0.25) return 'grey';
  const hue = max === r ? (((g - b) / delta) % 6 + 6) % 6 * 60 : max === g ? ((b - r) / delta + 2) * 60 : ((r - g) / delta + 4) * 60;
  let best: GroupColor = 'grey', bestDist = Infinity;
  for (const [h, color] of HUES) if (Math.abs(hue - h) < bestDist) { bestDist = Math.abs(hue - h); best = color; }
  return best;
}
