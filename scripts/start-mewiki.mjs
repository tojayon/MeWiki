import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error("请先安装 Node.js 22.13 或更新的受支持版本。"); process.exit(1);
}
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
function run(args) {
  const result = spawnSync(npm, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const fingerprint = createHash("sha256").update(readFileSync("package-lock.json")).digest("hex");
const marker = "node_modules/.mewiki-lock";
if (!existsSync(marker) || readFileSync(marker, "utf8") !== fingerprint) {
  console.log("正在准备 MeWiki 依赖，首次运行需要联网……");
  run(["ci", "--no-fund", "--no-audit"]); writeFileSync(marker, fingerprint);
}
console.log("正在构建 MeWiki……"); run(["run", "build"]);
console.log("MeWiki 地址：http://127.0.0.1:5280；请保持本窗口运行。");
const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "5280", "--strictPort", ...(process.argv.includes('--no-open') ? [] : ['--open'])], { cwd: root, stdio: "inherit", windowsHide: true });
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
