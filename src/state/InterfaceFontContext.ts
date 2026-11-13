import { createContext, useContext } from 'react';
import type { ResearchMediaAsset } from '../domain/researchMedia.ts';
import type { FontSizes, FontSizeTarget } from './fontSizes.ts';

export interface InterfaceFontState {
  fonts: ResearchMediaAsset[];
  selected: string | null;
  loading: boolean;
  working: boolean;
  error: string;
  notice: string;
  sizes: FontSizes;
  setSize: (target: FontSizeTarget, size: number) => void;
  choose: (fontId: string | null) => void;
  importFont: (file: File) => Promise<void>;
  downloadFont: () => Promise<void>;
}
export const InterfaceFontContext = createContext<InterfaceFontState | null>(null);
export function useInterfaceFont() {
  const value = useContext(InterfaceFontContext);
  if (!value) throw new Error('界面字体设置尚未准备好。');
  return value;
}
