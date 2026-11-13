import { expect, it } from 'vitest';
import { applyPublicationTemplate, systemPublicationOptions } from './publicationTheme.ts';
import { defaultPublicationOptions } from './publicationTypes.ts';
import { documentTheme } from '../styles/documentTheme.ts';

it('uses current document defaults and clears the reference when switching to a parameter template', () => {
  const original = { ...defaultPublicationOptions(), author: '作者', width: 1600, height: 900 };
  const native = applyPublicationTemplate(original, { id: 'native', name: '原生', style: 'document' });
  expect(native).toMatchObject({ author: '作者', width: 1600, height: 900, style: 'document', textColor: documentTheme.textColor, headingColor: documentTheme.headingColor, lineHeight: documentTheme.lineHeight });
  const custom = { id: 'custom', name: '自定义', background: '#FFFEEE', textColor: '#112233', headingColor: '#223344', accentColor: '#334455', fontFamily: 'serif' as const, fontSize: 36, lineHeight: 1.8 };
  const changed = applyPublicationTemplate(native, custom);
  expect(changed).not.toHaveProperty('style');
  expect(changed).toMatchObject({ author: '作者', fontFamily: 'serif', textColor: '#112233', fontSize: 36 });
  expect(original).not.toHaveProperty('style');
});

it('builds a complete system template snapshot instead of keeping parameters from the previous template', () => {
  const preset = { id: 'wide', name: '宽幅', width: 1600, height: 900 };
  const template = { id: 'native', name: '原生', style: 'document' as const };
  const options = systemPublicationOptions(template, preset);
  expect(options).toEqual({ ...defaultPublicationOptions(), width: 1600, height: 900, style: 'document', background: documentTheme.background, textColor: documentTheme.textColor, headingColor: documentTheme.headingColor, accentColor: documentTheme.accentColor, lineHeight: documentTheme.lineHeight });
  options.author = '临时作者'; options.margin = 120; options.format = 'jpeg'; options.cover = true;
  expect(systemPublicationOptions(template, preset)).toMatchObject({ author: '', margin: 72, format: 'png', cover: false, width: 1600, height: 900 });
});
