import { createContext, useContext, useSyncExternalStore } from 'react';
import { LibraryWorkspaceContext } from './LibraryWorkspaceContext.ts';
import type { ResearchLibrarySnapshot } from './researchLibraryController.ts';

type ContentLibrary = Pick<ResearchLibrarySnapshot, 'notebook' | 'directory' | 'busy' | 'status'> & {
  pixelRatio?: number;
  pdfPages?: Readonly<Record<string, number>>;
  onSelectPdfPage?: (blockId: string, page: number) => void;
};
/** A frozen reading surface needs resource locations, never a writable notebook session. */
export const ResearchContentLibraryContext = createContext<ContentLibrary | null>(null);
const noSubscription = () => () => {};
const noSnapshot = () => null;
export function useResearchContentLibrary(): ContentLibrary {
  const frozen = useContext(ResearchContentLibraryContext);
  const workspace = useContext(LibraryWorkspaceContext);
  const controller = frozen ? undefined : workspace?.session.controller;
  const live = useSyncExternalStore(controller?.subscribe ?? noSubscription, controller?.getSnapshot ?? noSnapshot);
  const value = frozen ?? live;
  if (!value) throw new Error('资料库工作区尚未准备好。');
  return value;
}
