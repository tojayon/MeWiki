import type { ReactNode } from 'react';
import { useLibraryWorkspace } from '../state/LibraryWorkspaceContext.ts';
import LibraryTypographyProvider from './LibraryTypographyProvider.tsx';

export default function InterfaceFontProvider({ children }: { children: ReactNode }) {
  const { profile } = useLibraryWorkspace();
  return <LibraryTypographyProvider key={profile.id} libraryId={profile.id} directory={profile.directory}>{children}</LibraryTypographyProvider>;
}
