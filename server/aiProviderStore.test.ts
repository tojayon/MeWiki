import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { AiProviderStore, systemAiSecretProtector } from './aiProviderStore.ts';

const roots: string[] = [];
const protector = {
  protect: async (value: string) => 'test:' + Buffer.from(value).toString('base64'),
  unprotect: async (value: string) => Buffer.from(value.slice(5), 'base64').toString(),
};
const provider = { id: 'example', name: '虚构服务', baseUrl: 'http://127.0.0.1:9999/v1', protocol: 'openai-chat' as const, model: 'fictional-model', apiKey: 'fictional-secret-987' };
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'mewiki-ai-store-')); roots.push(root);
  const filename = path.join(root, 'settings.json');
  return { filename, store: new AiProviderStore(filename, protector) };
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('mewiki-ai-store-')) throw new Error('Unsafe cleanup path');
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 30 });
  }
});
describe('AI service configuration', () => {
  it('persists a protected credential without exposing it in settings, preserves it on edit and clears it explicitly', async () => {
    const { store, filename } = await fixture();
    const empty = await store.read();
    const saved = await store.write({ revision: empty.revision, defaultProviderId: provider.id, providers: [provider] });
    expect(JSON.stringify(saved)).not.toContain(provider.apiKey);
    expect(saved.providers[0]).toMatchObject({ id: provider.id, hasApiKey: true });
    expect(await readFile(filename, 'utf8')).not.toContain(provider.apiKey);
    const { apiKey: _key, ...withoutKey } = provider;
    const edited = await store.write({ revision: saved.revision, defaultProviderId: provider.id, providers: [{ ...withoutKey, model: 'another-model' }] });
    expect((await store.resolve(provider.id)).apiKey).toBe(provider.apiKey);
    const cleared = await store.write({ revision: edited.revision, defaultProviderId: provider.id, providers: [{ ...withoutKey, apiKey: '' }] });
    expect(cleared.providers[0].hasApiKey).toBe(false);
    expect((await store.resolve(provider.id)).apiKey).toBe('');
  });
  it('rejects stale concurrent writes even through a second store instance', async () => {
    const { store, filename } = await fixture(); const empty = await store.read();
    await store.write({ revision: empty.revision, defaultProviderId: provider.id, providers: [provider] });
    await expect(new AiProviderStore(filename, protector).write({ revision: empty.revision, defaultProviderId: null, providers: [] })).rejects.toThrow(/其他窗口/);
    expect((await store.read()).providers).toHaveLength(1);
  });
  it('requires a fresh key when the origin changes and validates identities and protocols', async () => {
    const { store } = await fixture(); const empty = await store.read();
    const saved = await store.write({ revision: empty.revision, defaultProviderId: provider.id, providers: [provider] });
    const { apiKey: _key, ...withoutKey } = provider;
    await expect(store.write({ revision: saved.revision, defaultProviderId: provider.id, providers: [{ ...withoutKey, baseUrl: 'https://another.example/v1' }] })).rejects.toThrow(/重新输入/);
    for (const invalid of [{ ...provider, baseUrl: 'file:///private' }, { ...provider, baseUrl: 'https://user:pass@example.com/v1' }, { ...provider, protocol: 'guess' }, { ...provider, id: '__proto__' }]) {
      await expect(store.write({ revision: saved.revision, defaultProviderId: provider.id, providers: [invalid] } as never)).rejects.toThrow();
    }
  });
  it('projects a stored provider through the public whitelist even if extra credential fields are present', async () => {
    const { store, filename } = await fixture(); const empty = await store.read();
    await store.write({ revision: empty.revision, defaultProviderId: provider.id, providers: [provider] });
    const stored = JSON.parse(await readFile(filename, 'utf8'));
    stored.providers[0].apiKey = 'must-never-reach-client';
    await writeFile(filename, JSON.stringify(stored));
    expect(JSON.stringify(await store.read())).not.toContain('must-never-reach-client');
  });
  it('serializes simultaneous writes across independent store instances', async () => {
    const { store, filename } = await fixture(); const empty = await store.read();
    const input = { revision: empty.revision, defaultProviderId: provider.id, providers: [provider] };
    const results = await Promise.allSettled([store.write(input), new AiProviderStore(filename, protector).write(input)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  });
  it('round-trips a fictional key through the actual platform credential protector', async () => {
    const native = systemAiSecretProtector();
    const protectedValue = await native.protect('mewiki-fictional-native-test-key');
    expect(protectedValue).not.toContain('mewiki-fictional-native-test-key');
    expect(await native.unprotect(protectedValue)).toBe('mewiki-fictional-native-test-key');
    if (process.platform === 'win32') expect(protectedValue).toMatch(/^dpapi:/);
  });
});
