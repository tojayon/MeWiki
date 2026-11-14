import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { runAiEvaluation } = await import('../src/ai/evaluation.ts');
const report = await runAiEvaluation();
const destination = path.join(root, '.mewiki', 'ai-evaluation', 'latest.json');
await mkdir(path.dirname(destination), { recursive: true });
await writeFile(destination, JSON.stringify(report, null, 2) + '\n');
console.log(`Offline fictional fixtures: ${report.summary.completed}/${report.summary.tasks} passed; ${report.summary.outOfScope} out-of-scope changes; ${report.summary.invalidSources} invalid sources.`);
console.log(destination);
if (report.summary.completed !== report.summary.tasks) process.exitCode = 1;
