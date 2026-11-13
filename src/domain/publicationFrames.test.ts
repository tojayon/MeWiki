import { describe, expect, it } from 'vitest';
import { defaultPublicationOptions } from './publicationTypes.ts';
import { defaultPublicationFrame, publicationFrameLayout, publicationFrames, publicationContentSize, publicationPageInsets } from './publicationFrames.ts';

describe('publication device frame layout', () => {
  it('uses one restrained phone outline and derives matching screen corners from an even bezel', () => {
    for (const id of ['phone', 'phone-landscape']) {
      const { shell, screen } = publicationFrames.find(device => device.id === id)!;
      const inset = screen.x - shell.x;
      expect(screen.y - shell.y).toBe(inset);
      expect(shell.x + shell.width - screen.x - screen.width).toBe(inset);
      expect(shell.y + shell.height - screen.y - screen.height).toBe(inset);
      expect(screen.radius + inset).toBe(shell.radius);
      expect(shell.radius / Math.min(shell.width, shell.height)).toBeLessThanOrEqual(.11);
      expect(inset / Math.min(shell.width, shell.height)).toBeLessThanOrEqual(.035);
    }
    const portrait = publicationFrames.find(device => device.id === 'phone')!;
    const landscape = publicationFrames.find(device => device.id === 'phone-landscape')!;
    expect(landscape.screen.width).toBe(portrait.screen.height);
    expect(landscape.screen.height).toBe(portrait.screen.width);
    expect(landscape.screen.radius).toBe(portrait.screen.radius);
  });
  it('leaves old page dimensions unchanged and skips frames for long images', () => {
    const options = defaultPublicationOptions();
    expect(publicationFrameLayout(options)).toBeNull();
    expect(publicationContentSize(options)).toEqual({ width: options.width, height: options.height });
    const long = { ...options, mode: 'long' as const, frame: defaultPublicationFrame('phone') };
    expect(publicationFrameLayout(long)).toBeNull();
    expect(publicationContentSize(long)).toEqual({ width: long.width, height: long.height });
  });
  it('centers every device without stretching its screen or exceeding the output canvas', () => {
    for (const id of publicationFrames.map(frame => frame.id)) for (const [width, height] of [[1080, 1440], [1920, 1080], [720, 720], [480, 12000]]) {
      const options = { ...defaultPublicationOptions(), width, height, frame: defaultPublicationFrame(id) };
      const frame = publicationFrameLayout(options)!;
      expect(frame.left * 2 + frame.device.width * frame.unit).toBeCloseTo(width);
      expect(frame.top * 2 + frame.device.height * frame.unit).toBeCloseTo(height);
      expect(frame.left).toBeGreaterThan(0); expect(frame.top).toBeGreaterThan(0);
      const screen = frame.device.screen;
      const sheet = publicationContentSize(options);
      expect(sheet.width / sheet.height).toBeCloseTo(screen.width / screen.height);
      expect(sheet.width * frame.contentScale).toBeCloseTo(screen.width);
      expect(sheet.height * frame.contentScale).toBeCloseTo(screen.height);
    }
  });
  it('changes device size separately from content density and never changes saved source options', () => {
    const options = { ...defaultPublicationOptions(), frame: defaultPublicationFrame('laptop') };
    const before = structuredClone(options);
    const base = publicationFrameLayout(options)!;
    const smaller = publicationFrameLayout({ ...options, frame: { ...options.frame, scale: 60 } })!;
    expect(smaller.unit / base.unit).toBeCloseTo(.6);
    expect(smaller.width).toBe(base.width);
    const enlarged = publicationContentSize({ ...options, frame: { ...options.frame, contentScale: 125 } });
    expect(enlarged.width).toBeCloseTo(base.width / 1.25);
    expect(options).toEqual(before);
  });
  it('preserves ordinary margins and reserves a safe area only where rounded corners need it', () => {
    const options = defaultPublicationOptions();
    expect(publicationPageInsets(options)).toEqual({ header: 36, body: 104 });
    expect(publicationPageInsets({ ...options, frame: defaultPublicationFrame('phone') })).toEqual({ header: 36, body: 104 });
    const minimal = { ...options, width: 1920, height: 1080, margin: 16, fontSize: 20, frame: defaultPublicationFrame('phone') };
    const safe = publicationPageInsets(minimal);
    expect(safe.header).toBeGreaterThan(8);
    expect(safe.body).toBeGreaterThan(safe.header + Math.max(minimal.fontSize, 12 * 1.3) + 3);
    expect(publicationPageInsets({ ...minimal, mode: 'long' })).toEqual({ header: 8, body: 36 });
  });
});
