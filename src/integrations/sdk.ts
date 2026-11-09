import type { ExternalContent } from './externalContent.ts';
export interface ConnectedApplication { id: string; name: string; providers: string[]; capabilities: string[]; origin: string }
export interface EmbeddedConnection {
  ready: Promise<unknown>;
  openContent: (content: ExternalContent) => Promise<unknown>;
  dispose: () => void;
}
export interface HostSdk {
  connectHost: (options: { onContext: (content: unknown) => void; onConnection: (app: ConnectedApplication) => void }) => EmbeddedConnection | null;
}
export async function loadHostSdk(): Promise<HostSdk> {
  const url = '/integration/mewiki-host.js';
  return import(/* @vite-ignore */ url);
}
