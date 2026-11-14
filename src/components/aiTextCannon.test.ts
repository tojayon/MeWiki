import { describe, expect, it } from 'vitest';
import { cannonEraseSteps, cannonFragment, cannonReplayFragments, cannonReplaySteps, cannonShot, cannonVisiblePrefix } from './aiTextCannon.ts';

describe('cannon aiming', () => {
  it('points its muzzle along the ray to targets on either side of the note', () => {
    for (const x of [80, 320]) {
      const shot = cannonShot({ x: 200, y: 400 }, { x, y: 100 }, 40)!;
      expect(Math.sign(shot.angle)).toBe(Math.sign(x - 200));
      const a = { x: shot.origin.x - 200, y: shot.origin.y - 400 };
      const b = { x: x - 200, y: -300 };
      expect(a.x * b.y - a.y * b.x).toBeCloseTo(0);
      expect(Math.hypot(a.x, a.y)).toBeCloseTo(40);
      expect(a.y).toBeLessThan(0);
    }
  });

  it('keeps the same direction after the note viewport is moved and scaled', () => {
    const first = cannonShot({ x: 200, y: 400 }, { x: 300, y: 100 }, 40)!;
    const moved = cannonShot({ x: 500, y: 1000 }, { x: 700, y: 400 }, 80)!;
    expect(moved.angle).toBeCloseTo(first.angle);
    expect(moved.origin.x).toBeCloseTo(first.origin.x * 2 + 100);
    expect(moved.origin.y).toBeCloseTo(first.origin.y * 2 + 200);
  });

  it('does not fire behind the cannon, at an overlapping target, or at invalid coordinates', () => {
    expect(cannonShot({ x: 100, y: 100 }, { x: 120, y: 110 }, 30)).toBeNull();
    expect(cannonShot({ x: 100, y: 100 }, { x: 100, y: 90 }, 30)).toBeNull();
    expect(cannonShot({ x: 100, y: 100 }, { x: NaN, y: 10 }, 30)).toBeNull();
  });
});

describe('cannon replay phrases', () => {
  it('erases every original grapheme in order without skipping long text or splitting emoji', () => {
    const text = '甲👨‍👩‍👧‍👦e\u0301\n乙';
    const steps = cannonEraseSteps(text);
    expect(steps.map(step => text.slice(step.start, step.end))).toEqual(['甲', '👨‍👩‍👧‍👦', 'e\u0301', '\n', '乙']);
    expect(steps[0].start).toBe(0);
    expect(steps.at(-1)!.end).toBe(text.length);
    expect(cannonEraseSteps('旧'.repeat(200))).toHaveLength(200);
    expect(cannonEraseSteps('')).toEqual([]);
  });

  it('maps normalized ammunition back to the complete original text at each landing', () => {
    const text = '  甲\n\n乙\t丙  丁  ';
    const steps = cannonReplaySteps(text);
    expect(steps.map(step => step.text).join('')).toBe('甲 乙 丙 丁');
    expect(steps[0]).toEqual({ text: '甲 ', start: 0, end: 5 });
    expect(steps.at(-1)!.end).toBe(text.length);
    for (let i = 1; i < steps.length; i++) expect(steps[i].start).toBe(steps[i - 1].end);
  });

  it('reveals complete graphemes and the truncated remainder when the final phrase lands', () => {
    const family = '👨‍👩‍👧‍👦', text = family.repeat(40);
    const steps = cannonReplaySteps(text);
    expect(steps[0].end).toBe(family.length * 8);
    expect(steps.at(-1)).toEqual({ text: family.repeat(8) + '…', start: family.length * 24, end: text.length });
    expect(cannonVisiblePrefix('Ae\u0301旧', 'Ae\u0301新')).toBe('Ae\u0301');
    expect(cannonVisiblePrefix('Ae', 'Ae\u0301新')).toBe('A');
    expect(cannonVisiblePrefix('旧文', '新文')).toBe('');
  });

  it('starts inside a long visible change without replaying the text above the viewport', () => {
    const text = '已经看过的前文。现在开始的修改';
    const start = text.indexOf('现在');
    const steps = cannonReplaySteps(text, start);
    expect(steps[0].start).toBe(start);
    expect(steps.map(step => step.text).join('')).toBe(text.slice(start));
    expect(steps.at(-1)!.end).toBe(text.length);
    const family = '👨‍👩‍👧‍👦';
    expect(cannonReplaySteps('甲' + family + '乙', 2)[0].start).toBe(1);
  });

  it('splits a finished change into small phrases without changing its text', () => {
    expect(cannonReplayFragments('')).toEqual([]);
    expect(cannonReplayFragments('  \n ')).toEqual([]);
    expect(cannonReplayFragments('新')).toEqual(['新']);
    const text = '这是一段已经完整生成的修改';
    const fragments = cannonReplayFragments(text);
    expect(fragments.length).toBeGreaterThan(1);
    expect(fragments.length).toBeLessThanOrEqual(4);
    expect(fragments.join('')).toBe(text);
  });

  it('bounds long replays and keeps complete graphemes in every phrase', () => {
    const family = '👨‍👩‍👧‍👦';
    expect(cannonReplayFragments(family.repeat(40))).toEqual([family.repeat(8), family.repeat(8), family.repeat(8), family.repeat(8) + '…']);
    const accent = 'e\u0301';
    expect(cannonReplayFragments(accent.repeat(6))).toEqual([accent.repeat(2), accent.repeat(2), accent.repeat(2)]);
  });
});

describe('text ammunition', () => {
  it('extracts a new phrase rather than replaying unchanged paragraphs', () => {
    expect(cannonFragment('定义中的旧条件保持。', '定义中的新条件保持。')).toBe('新');
    expect(cannonFragment('定义', '定义与适用范围')).toBe('与适用范围');
    expect(cannonFragment('保持不变', '保持不变')).toBeNull();
    expect(cannonFragment('正文', '正文\n ')).toBeNull();
  });

  it('shows the removed fragment for a deletion', () => {
    expect(cannonFragment('定义中的多余条件。', '定义中的条件。')).toBe('多余');
  });

  it('bounds the visual label without splitting emoji or combining characters', () => {
    const family = '👨‍👩‍👧‍👦', accent = 'e\u0301';
    expect(cannonFragment('', family.repeat(14))).toBe(family.repeat(10) + '…');
    expect(cannonFragment('', accent.repeat(14))).toBe(accent.repeat(10) + '…');
  });
});
