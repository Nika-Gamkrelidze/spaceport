import { describe, expect, test } from 'vitest';
import { nearestGroupColor } from './colors';

describe('nearestGroupColor', () => {
  test('no color is grey', () => expect(nearestGroupColor(undefined)).toBe('grey'));

  test.each([
    [{ r: 128, g: 128, b: 128 }, 'grey'],
    [{ r: 0, g: 0, b: 0 }, 'grey'],
    [{ r: 250, g: 245, b: 240 }, 'grey'],
    [{ r: 230, g: 30, b: 30 }, 'red'],
    [{ r: 240, g: 140, b: 20 }, 'orange'],
    [{ r: 240, g: 220, b: 30 }, 'yellow'],
    [{ r: 40, g: 200, b: 60 }, 'green'],
    [{ r: 30, g: 210, b: 220 }, 'cyan'],
    [{ r: 40, g: 90, b: 230 }, 'blue'],
    [{ r: 140, g: 50, b: 220 }, 'purple'],
    [{ r: 230, g: 60, b: 170 }, 'pink'],
    [{ r: 240, g: 20, b: 50 }, 'red'],
  ] as const)('%o → %s', (rgb, color) => expect(nearestGroupColor(rgb)).toBe(color));
});
