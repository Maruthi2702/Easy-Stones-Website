import { describe, expect, it } from 'vitest';
import { coverCrop } from './cameraCrop';

describe('coverCrop', () => {
  it('cuts the sides of a wide frame shown in a tall box', () => {
    // 4:3 portrait frame (1920x2560) in a 390x844 box: full height, sides trimmed
    const c = coverCrop(1920, 2560, 390, 844);
    expect(c.sh).toBe(2560);
    expect(c.sw).toBe(Math.round(390 * (2560 / 844)));
    expect(c.sx).toBe(Math.round((1920 - c.sw) / 2));
    expect(c.sy).toBe(0);
  });
  it('cuts top and bottom when the frame is taller than the box', () => {
    const c = coverCrop(1000, 2000, 400, 400);
    expect(c).toEqual({ sx: 0, sy: 500, sw: 1000, sh: 1000 });
  });
  it('keeps a frame that already has the box shape', () => {
    expect(coverCrop(800, 600, 400, 300)).toEqual({ sx: 0, sy: 0, sw: 800, sh: 600 });
  });
  it('never crops when a size is unknown', () => {
    expect(coverCrop(800, 600, 0, 0)).toEqual({ sx: 0, sy: 0, sw: 800, sh: 600 });
  });
});
