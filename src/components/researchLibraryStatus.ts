import type { ResearchLibrarySnapshot } from "../state/researchLibraryController.ts";

export function librarySaveLabel(library: ResearchLibrarySnapshot) {
  switch (library.status) {
    case "loading":
      return "正在读取本地资料库…";
    case "browser":
      return "仅保存在浏览器 · 设置本地保存路径";
    case "pending":
      return "待写入本地…";
    case "saving":
      return "正在保存到本地…";
    case "conflict":
      return "发现版本冲突 · 当前修改已保留";
    case "error":
      return "本地保存已暂停 · 查看详情";
    case "saved":
      return `已保存到本地${library.savedAt ? " · " + new Date(library.savedAt).toLocaleTimeString("zh-CN", { hour12: false }) : ""}`;
  }
}
