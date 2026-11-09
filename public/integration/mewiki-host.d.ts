export const PROTOCOL: 'mewiki.integration';
export function exportLegacyBrowserNotebook(): Promise<void>;
export interface MessagePeer {
  handle(method: string, handler: (value: unknown) => unknown): () => boolean;
  request(method: string, params?: unknown): Promise<unknown>;
  dispose(): void;
}
export interface PeerOptions {
  target: { postMessage(value: unknown, origin: string): void };
  origin: string; session: string; timeout?: number;
  self?: { addEventListener(type: 'message', listener: (event: MessageEvent) => void): void; removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void };
}
export interface Application { id: string; name: string; providers: string[]; capabilities: ('context.read' | 'content.open')[] }
export function integrationUrl(url: string, options: { hostOrigin: string; session: string }): string;
export function createMessagePeer(options: PeerOptions): MessagePeer;
export function connectMeWiki(options: { iframe: HTMLIFrameElement; url: string; app: Application; onOpen?: (content: unknown) => unknown; timeout?: number }): { ready: Promise<void>; setContext(content: unknown): Promise<unknown>; dispose(): void };
export function connectHost(options: { onContext(content: unknown): unknown; onConnection?(app: Application & { origin: string }): void; timeout?: number }): { ready: Promise<Application>; openContent(content: unknown): Promise<unknown>; dispose(): void } | null;
