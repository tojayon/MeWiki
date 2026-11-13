import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ExportProfileStore } from './exportProfileStore.ts';
import { defaultPublicationOptions } from '../src/domain/publicationTypes.ts';
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
it('isolates profiles by stable library and plugin and rejects stale writes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mewiki-export-profiles-')); directories.push(directory);
  const store = new ExportProfileStore(directory);
  const initial = await store.read('default', 'org.example.export');
  const profiles = [{ id: 'mine', name: '个人风格', templateId: 'clear', templateVersion: '1.0.0', options: defaultPublicationOptions() }];
  await store.write('default', 'org.example.export', initial.revision, profiles);
  expect((await store.read('other', 'org.example.export')).profiles).toEqual([]);
  expect((await store.read('default', 'org.other.export')).profiles).toEqual([]);
  await expect(store.write('default', 'org.example.export', initial.revision, [])).rejects.toThrow('模板已在其他窗口更新');
  expect((await new ExportProfileStore(directory).read('default', 'org.example.export')).profiles).toEqual(profiles);
});
it('serializes independent service instances before checking revisions', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mewiki-export-profiles-')); directories.push(directory);
  const first = new ExportProfileStore(directory), second = new ExportProfileStore(directory);
  const initial = await first.read('default', 'org.example.export');
  const profile = { id: 'mine', name: '风格', templateId: 'clear', templateVersion: '1.0.0', options: defaultPublicationOptions() };
  const writes = await Promise.allSettled([first.write('default', 'org.example.export', initial.revision, [profile]), second.write('default', 'org.example.export', initial.revision, [{ ...profile, name: '不同风格' }])]);
  expect(writes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(writes.filter(result => result.status === 'rejected')).toHaveLength(1);
});
