import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function retry(operation: () => Promise<void>) {
  const start = Date.now();
  for (;;) {
    try { await operation(); return; }
    catch (cause) { if (!['EPERM', 'EACCES', 'EBUSY'].includes((cause as NodeJS.ErrnoException).code ?? '') || Date.now() - start > 10000) throw cause; await pause(); }
  }
}
/** Bakery claims have unique identities, so crash recovery never removes a replacement owner. */
export async function withExportProfileLock<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(directory, { recursive: true });
  const name = `${process.pid}-${randomUUID()}.lock`;
  const file = path.join(directory, name), ticketFile = file + '.ticket', temporary = file + '.tmp';
  const start = Date.now();
  const handle = await open(file, 'wx'); await handle.close();
  const remove = (file: string) => retry(() => rm(file, { force: true }));
  try {
    const contenders = async () => {
      const values: { name: string; ticket: number }[] = [];
      for (const entry of await readdir(directory)) {
        const match = /^([1-9]\d*)-[0-9a-f-]{36}\.lock$/.exec(entry);
        if (!match || entry === name) continue;
        const other = path.join(directory, entry);
        try { process.kill(Number(match[1]), 0); }
        catch (cause) {
          if ((cause as NodeJS.ErrnoException).code === 'ESRCH') { await remove(other + '.ticket'); await remove(other); continue; }
          if ((cause as NodeJS.ErrnoException).code !== 'EPERM') throw cause;
        }
        let source: string;
        try { source = await readFile(other + '.ticket', 'utf8'); }
        catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') { values.push({ name: entry, ticket: 0 }); continue; } throw cause; }
        const ticket: unknown = JSON.parse(source);
        if (!Number.isSafeInteger(ticket) || Number(ticket) < 1) throw new Error('个人模板锁文件无效，请检查本地配置。');
        values.push({ name: entry, ticket: Number(ticket) });
      }
      return values;
    };
    const ticket = (await contenders()).reduce((value, contender) => Math.max(value, contender.ticket), 0) + 1;
    if (!Number.isSafeInteger(ticket)) throw new Error('个人模板锁文件无效，请检查本地配置。');
    const ticketHandle = await open(temporary, 'wx');
    try { await ticketHandle.writeFile(JSON.stringify(ticket)); await ticketHandle.sync(); } finally { await ticketHandle.close(); }
    await retry(() => rename(temporary, ticketFile));
    while ((await contenders()).some(other => other.ticket === 0 || other.ticket < ticket || other.ticket === ticket && other.name < name)) {
      if (Date.now() - start > 10000) throw new Error('个人模板正在其他窗口保存，请稍后重试。');
      await pause();
    }
    return await operation();
  } finally { await remove(temporary); await remove(ticketFile); await remove(file); }
}
