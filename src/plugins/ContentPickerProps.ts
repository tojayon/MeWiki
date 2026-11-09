import type { ExternalContent } from '../integrations/externalContent.ts';

export interface ContentPickerProps {
  onSelect: (content: ExternalContent) => void;
  onClose: () => void;
}
