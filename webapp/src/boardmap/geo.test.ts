// Geometry tests: the nine-grid word assertion matrix demanded by the M3
// acceptance (four corners / center / third-line boundaries x calibration
// 0/90/180/270), mirror word transforms, nearest-landmark pick, calibration
// rotation math incl. 359->0 wraparound.

import { describe, expect, it } from 'vitest';
import {
  directionWord,
  effectiveDeg,
  mirrorPt,
  nearestLandmark,
  normDeg,
  rotatePt,
  rotatedExtents,
  toViewFrame,
} from './geo';

const B = { w: 30, h: 20 };

// The full 3x3 cell centers, corner-anchored so bands are unambiguous.
const CELLS: [number, number, string][] = [
  [3, 3, '左上'],
  [15, 3, '正上'],
  [27, 3, '右上'],
  [3, 10, '左中'],
  [15, 10, '正中'],
  [27, 10, '右中'],
  [3, 17, '左下'],
  [15, 17, '正下'],
  [27, 17, '右下'],
];

describe('nine-grid word matrix (top face, flip none)', () => {
  it('calib 0: drawing orientation == user orientation', () => {
    for (const [x, y, word] of CELLS) {
      expect(directionWord({ x, y }, B, 'none', 0)).toBe(word);
    }
  });

  it('calib 90: the grid rotates rigidly with the board (左上 -> 右上 ...)', () => {
    const expected: Record<string, string> = {
      左上: '右上',
      正上: '右中',
      右上: '右下',
      左中: '正上',
      正中: '正中',
      右中: '正下',
      左下: '左上',
      正下: '左中',
      右下: '左下',
    };
    for (const [x, y, word] of CELLS) {
      expect(directionWord({ x, y }, B, 'none', 90)).toBe(expected[word]);
    }
  });

  it('calib 180 and 270 keep rotating the same rigid grid', () => {
    const rot180: Record<string, string> = {
      左上: '右下', 正上: '正下', 右上: '左下',
      左中: '右中', 正中: '正中', 右中: '左中',
      左下: '右上', 正下: '正上', 右下: '左上',
    };
    const rot270: Record<string, string> = {
      左上: '左下', 正上: '左中', 右上: '左上',
      左中: '正下', 正中: '正中', 右中: '正上',
      左下: '右下', 正下: '右中', 右下: '右上',
    };
    for (const [x, y, word] of CELLS) {
      expect(directionWord({ x, y }, B, 'none', 180)).toBe(rot180[word]);
      expect(directionWord({ x, y }, B, 'none', 270)).toBe(rot270[word]);
    }
  });

  it('third-line boundaries: [w/3, 2w/3) is the middle band', () => {
    expect(directionWord({ x: 10, y: 10 }, B, 'none', 0)).toBe('正中'); // x == w/3
    expect(directionWord({ x: 9.999, y: 10 }, B, 'none', 0)).toBe('左中');
    expect(directionWord({ x: 20, y: 10 }, B, 'none', 0)).toBe('右中'); // x == 2w/3
    expect(directionWord({ x: 15, y: 6.666 }, B, 'none', 0)).toBe('正上');
    expect(directionWord({ x: 15, y: 6.667 }, B, 'none', 0)).toBe('正中');
  });
});

describe('mirror transforms (bottom face)', () => {
  it('lr flip mirrors x: the point jumps to the opposite column', () => {
    expect(directionWord({ x: 3, y: 3 }, B, 'lr', 0)).toBe('右上');
    expect(directionWord({ x: 27, y: 3 }, B, 'lr', 0)).toBe('左上');
    expect(mirrorPt({ x: 3, y: 3 }, B, 'lr')).toEqual({ x: 27, y: 3 });
  });

  it('tb flip mirrors y', () => {
    expect(directionWord({ x: 3, y: 3 }, B, 'tb', 0)).toBe('左下');
    expect(mirrorPt({ x: 3, y: 3 }, B, 'tb')).toEqual({ x: 3, y: 17 });
  });

  it('bottom face + calibration: mirror applies before rotation', () => {
    // (3,3) lr-mirrored to (27,3), then 90° CW lands at view (17,27) -> 右下
    expect(directionWord({ x: 3, y: 3 }, B, 'lr', 90)).toBe('右下');
    // sanity: without mirror it would be 右上
    expect(directionWord({ x: 27, y: 3 }, B, 'none', 90)).toBe('右下');
  });
});

describe('calibration rotation math', () => {
  it('rotatePt turns +x (right) toward +y (down): visual clockwise', () => {
    const r = rotatePt({ x: 1, y: 0 }, 90);
    expect(r.x).toBeCloseTo(0, 6);
    expect(r.y).toBeCloseTo(1, 6);
  });

  it('rotatedExtents swaps w/h for 90/270', () => {
    const close = (b: { w: number; h: number }, w: number, h: number) => {
      expect(b.w).toBeCloseTo(w, 6);
      expect(b.h).toBeCloseTo(h, 6);
    };
    close(rotatedExtents(B, 0), 30, 20);
    close(rotatedExtents(B, 90), 20, 30);
    close(rotatedExtents(B, 180), 30, 20);
    close(rotatedExtents(B, 270), 20, 30);
  });

  it('toViewFrame maps corners consistently for 90°', () => {
    // drawing top-left -> view top-right (rigid rotation)
    expect(toViewFrame({ x: 0, y: 0 }, B, 'none', 90).x).toBeCloseTo(20, 6);
    expect(toViewFrame({ x: 0, y: 0 }, B, 'none', 90).y).toBeCloseTo(0, 6);
    // drawing bottom-right -> view top-left
    expect(toViewFrame({ x: 30, y: 20 }, B, 'none', 90).x).toBeCloseTo(0, 6);
    expect(toViewFrame({ x: 30, y: 20 }, B, 'none', 90).y).toBeCloseTo(30, 6);
  });

  it('effectiveDeg wraps around 360 (359->0 style)', () => {
    expect(effectiveDeg(350, 10)).toBe(0);
    expect(effectiveDeg(270, 90)).toBe(0);
    expect(effectiveDeg(90, 180)).toBe(270);
    expect(effectiveDeg(-90, 0)).toBe(270);
    expect(normDeg(720)).toBe(0);
  });
});

describe('nearest landmark', () => {
  const lms = [
    { ref: 'J1', speak: 'Type-C 座', x_mm: 5, y_mm: 5 },
    { ref: 'J2', speak: '电源端子', x_mm: 25, y_mm: 15 },
  ];
  it('picks the Euclidean-nearest', () => {
    expect(nearestLandmark({ x: 6, y: 6 }, lms)?.ref).toBe('J1');
    expect(nearestLandmark({ x: 24, y: 14 }, lms)?.ref).toBe('J2');
    expect(nearestLandmark({ x: 22, y: 12 }, lms)?.ref).toBe('J2'); // 18 vs 338
    expect(nearestLandmark({ x: 15, y: 9 }, lms)?.ref).toBe('J1'); // 116 vs 136
  });
  it('ties resolve to the first landmark', () => {
    expect(nearestLandmark({ x: 15, y: 10 }, lms)?.ref).toBe('J1');
  });
  it('empty landmark list -> null', () => {
    expect(nearestLandmark({ x: 1, y: 1 }, [])).toBeNull();
  });
});
