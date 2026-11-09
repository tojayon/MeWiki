import { createContext, useContext } from 'react';
import type { ExternalContent } from './externalContent.ts';
import type { ConnectedApplication } from './sdk.ts';
import type { PluginState, PluginStatus } from '../plugins/registry.ts';
export interface IntegrationState {
  plugins: PluginState;
  content: ExternalContent | null;
  insertion: { content: ExternalContent; label: string } | null;
  insertions: { provider: string; label: string; description: string }[];
  chooseContent: (provider: string, signal: AbortSignal) => Promise<ExternalContent | null>;
  connection: ConnectedApplication | null;
  error: string;
  setPlugin: (id: string, status: PluginStatus) => void;
  showManager: () => void;
  openContent: (content: ExternalContent) => Promise<void>;
}
const defaults: IntegrationState = { plugins: {}, content: null, insertion: null, insertions: [], chooseContent: async () => null, connection: null, error: '', setPlugin: () => {}, showManager: () => {}, openContent: async () => { throw new Error('外部内容连接不可用。'); } };
export const IntegrationContext = createContext<IntegrationState>(defaults);
export const useIntegration = () => useContext(IntegrationContext);
