import {t, getLocale as interfaceLocale } from "../i18n/locale.ts";
import type { ResearchLibrarySnapshot } from "../state/researchLibraryController.ts";

export function librarySaveLabel(library: ResearchLibrarySnapshot) {
  switch (library.status) {
    case "loading":
      return t("正在读取本地资料库…");
    case "browser":
      return t("仅保存在浏览器 · 设置本地保存路径");
    case "pending":
      return t("待写入本地…");
    case "saving":
      return t("正在保存到本地…");
    case "conflict":
      return t("发现版本冲突 · 当前修改已保留");
    case "error":
      return t("本地保存已暂停 · 查看详情");
    case "saved":
      return t`已保存到本地${library.savedAt ? " · " + new Date(library.savedAt).toLocaleTimeString(interfaceLocale(), { hour12: false }) : ""}`;
  }
}
