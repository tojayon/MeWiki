import { describe, expect, it } from 'vitest';
import { aiDiffRanges, diffAiText } from './diff.ts';

describe('AI text review diff', () => {
  it('keeps the unchanged middle of a long paragraph between distant word edits', () => {
    const middle = '保留这一段背景说明与适用条件。'.repeat(100);
    const before = `系统始终稳定。${middle}响应迅速。`, after = `系统局部稳定。${middle}响应平稳。`;
    const lines = diffAiText(before, after);
    expect(lines.filter(line => line.kind === 'remove').flatMap(line => line.parts.filter(part => part.changed).map(part => part.text)).join('')).toBe('始终迅速');
    expect(lines.filter(line => line.kind === 'add').flatMap(line => line.parts.filter(part => part.changed).map(part => part.text)).join('')).toBe('局部平稳');
    expect(lines.filter(line => line.kind !== 'add').map(line => line.text).join('\n')).toBe(before);
    expect(lines.filter(line => line.kind !== 'remove').map(line => line.text).join('\n')).toBe(after);
  });
  it('aligns inline changes across reflowed lines instead of pairing unrelated line numbers', () => {
    const lines = diffAiText('系统始终稳定，\n背景保持，响应迅速。', '系统局部稳定，背景保持，\n响应平稳。');
    expect(lines.filter(line => line.kind === 'remove').flatMap(line => line.parts.filter(part => part.changed).map(part => part.text)).join('')).toBe('始终迅速');
    expect(lines.filter(line => line.kind === 'add').flatMap(line => line.parts.filter(part => part.changed).map(part => part.text)).join('')).toBe('局部平稳');
    for (const line of lines) expect(line.parts.map(part => part.text).join('')).toBe(line.text);
  });
  it('preserves both texts and source ranges for repeated lines and sparse emoji changes', () => {
    let seed = 7;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    const tokens = ['a', 'b', ' ', '中', '文', '\n', '👩🏽‍💻'];
    for (let sample = 0; sample < 100; sample++) {
      const before = Array.from({ length: random() % 120 }, () => tokens[random() % tokens.length]).join('');
      const after = Array.from({ length: random() % 120 }, () => tokens[random() % tokens.length]).join('');
      const lines = diffAiText(before, after);
      expect(lines.filter(line => line.kind !== 'add').map(line => line.text).join('\n')).toBe(before);
      expect(lines.filter(line => line.kind !== 'remove').map(line => line.text).join('\n')).toBe(after);
      for (const [side, text] of [['remove', before], ['add', after]] as const) {
        const ranges = aiDiffRanges(lines, side);
        expect(ranges.every(range => range.start >= 0 && range.end <= text.length && range.end > range.start)).toBe(true);
        expect(ranges.map(range => text.slice(range.start, range.end)).join('')).toBe(lines.filter(line => line.kind === side).map(line => line.parts.filter(part => part.changed).map(part => part.text).join('') + (line.newlineChanged ? '\n' : '')).join(''));
      }
    }
  });
  it('keeps context and identifies deleted and inserted lines with both line numbers', () => {
    const lines = diffAiText('第一行\n旧定义\n第三行', '第一行\n新定义\n第三行\n补充');
    expect(lines.map(({ kind, text, beforeLine, afterLine }) => ({ kind, text, beforeLine, afterLine }))).toEqual([
      { kind: 'context', text: '第一行', beforeLine: 1, afterLine: 1 },
      { kind: 'remove', text: '旧定义', beforeLine: 2, afterLine: undefined },
      { kind: 'add', text: '新定义', beforeLine: undefined, afterLine: 2 },
      { kind: 'context', text: '第三行', beforeLine: 3, afterLine: 3 },
      { kind: 'add', text: '补充', beforeLine: undefined, afterLine: 4 },
    ]);
  });
  it('highlights Chinese edits inside a line without marking shared text as changed', () => {
    const [removed, added] = diffAiText('系统始终稳定。', '系统局部稳定。');
    expect(removed.parts).toEqual([{ text: '系统', changed: false }, { text: '始终', changed: true }, { text: '稳定。', changed: false }]);
    expect(added.parts).toEqual([{ text: '系统', changed: false }, { text: '局部', changed: true }, { text: '稳定。', changed: false }]);
  });
  it('shows pure additions and removals without phantom empty context lines', () => {
    expect(diffAiText('', '新增段落')).toMatchObject([{ kind: 'add', text: '新增段落' }]);
    expect(diffAiText('删除段落', '')).toMatchObject([{ kind: 'remove', text: '删除段落' }]);
    expect(diffAiText('', '')).toEqual([]);
  });
  it('preserves blank lines, trailing newline and repeated lines when reconstructing either side', () => {
    const before = '开头\n\n重复\n重复\n旧行\n', after = '开头\n新行\n重复\n\n重复\n';
    const lines = diffAiText(before, after);
    expect(lines.filter(line => line.kind !== 'add').map(line => line.text).join('\n')).toBe(before);
    expect(lines.filter(line => line.kind !== 'remove').map(line => line.text).join('\n')).toBe(after);
  });
  it('keeps emoji graphemes intact in inline edits', () => {
    const lines = diffAiText('成员👨‍👩‍👧‍👦完成。', '成员👩🏽‍💻完成。');
    expect(lines[0].parts.filter(part => part.changed).map(part => part.text).join('')).toBe('👨‍👩‍👧‍👦');
    expect(lines[1].parts.filter(part => part.changed).map(part => part.text).join('')).toBe('👩🏽‍💻');
  });
  it('handles long disjoint content with bounded work and retains shared surrounding lines', () => {
    const before = `首行\n${'甲'.repeat(40000)}\n末行`, after = `首行\n${'乙'.repeat(40000)}\n末行`;
    const lines = diffAiText(before, after);
    expect(lines).toHaveLength(4);
    expect(lines[0].kind).toBe('context'); expect(lines[3].kind).toBe('context');
    expect(lines.filter(line => line.kind !== 'add').map(line => line.text).join('\n')).toBe(before);
    expect(lines.filter(line => line.kind !== 'remove').map(line => line.text).join('\n')).toBe(after);
  });
  it('bounds comparison of many unrelated lines and preserves both complete versions', () => {
    const before = Array.from({ length: 4000 }, (_, i) => `旧行 ${i}`).join('\n');
    const after = Array.from({ length: 4000 }, (_, i) => `新行 ${i}`).join('\n');
    const lines = diffAiText(before, after);
    expect(lines.filter(line => line.kind !== 'add').map(line => line.text).join('\n')).toBe(before);
    expect(lines.filter(line => line.kind !== 'remove').map(line => line.text).join('\n')).toBe(after);
  });
});
