import { describe, expect, it } from "vitest";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

describe.skipIf(process.platform !== "win32")("Windows double-click launcher", () => {
  it("passes the full script name to Node from a directory with spaces and Chinese characters", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "mewiki-launcher-中文 空格-"));
    try {
      copyFileSync("Start-MeWiki.bat", path.join(directory, "Start-MeWiki.bat"));
      writeFileSync(path.join(directory, "node.cmd"), "@echo off\r\necho NODE_SCRIPT=%*\r\nexit /b 0\r\n");
      const result = spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/c", "Start-MeWiki.bat"], { cwd: directory, encoding: "utf8", timeout: 3000, input: "\n" });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr + result.stdout).toBe(0);
      expect(result.stdout).toContain("NODE_SCRIPT=scripts/start-mewiki.mjs");
    } finally {
      if (path.dirname(directory) === path.resolve(tmpdir()) && path.basename(directory).startsWith("mewiki-launcher-")) rmSync(directory, { recursive: true, force: true });
    }
  });
});
