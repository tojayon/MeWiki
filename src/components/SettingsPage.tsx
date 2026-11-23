import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, BookOpen, ChevronRight, Download, FolderOpen, HardDrive, History, Info, PanelLeft, Plug, Search, SearchX, Settings2, X } from "lucide-react";
import AiMascot from './AiMascot.tsx';
import { useLocale } from "../i18n/react.ts";
import { t, localizeError } from "../i18n/locale.ts";
import { buildSettingsUrl, closeSettings, openSettings, searchSettings, type SettingsSection } from "../state/settingsNavigation.ts";
import { useLibraryWorkspace } from "../state/LibraryWorkspaceContext.ts";
import type { useResearchLibrary } from "../state/useResearchNotebook.ts";
import LanguageSettings from "./LanguageSettings.tsx";
import InterfaceFontSettings from './InterfaceFontSettings.tsx';
import UiInfo from './UiInfo.tsx';
import AiServiceSettings from './AiServiceSettings.tsx';
import LibraryManager from "./LibraryManager.tsx";
import ResearchLibraryStorage from "./ResearchLibraryStorage.tsx";
import PluginManager from "../plugins/PluginManager.tsx";
import { librarySaveLabel } from "./researchLibraryStatus.ts";
import "./SettingsPage.css";

type Library = ReturnType<typeof useResearchLibrary>;
interface Props {
  section: SettingsSection | null;
  library: Library;
  readOnly: boolean;
  sidebarCollapsed: boolean;
  outlineCollapsed: boolean;
  onReadOnlyChange: (value: boolean) => void;
  onSidebarCollapsedChange: (value: boolean) => void;
  onOutlineCollapsedChange: (value: boolean) => void;
  onOpenHelp?: () => void;
  onBusyChange?: (busy: boolean) => void;
}

function SettingsGroup({ title, description, children, id }: { title: string; description?: string; children: ReactNode; id?: string }) {
  return <section className="mewiki-settings-group" id={id} tabIndex={id ? -1 : undefined}>
    <header><h3>{title}</h3>{description && <UiInfo label={t`${title}设置说明`}><p>{description}</p></UiInfo>}</header>
    <div className="mewiki-settings-group-body">{children}</div>
  </section>;
}

export default function SettingsPage({ section, library, readOnly, sidebarCollapsed, outlineCollapsed, onReadOnlyChange, onSidebarCollapsedChange, onOutlineCollapsedChange, onOpenHelp, onBusyChange }: Props) {
  useLocale();
  const workspace = useLibraryWorkspace();
  const [query, setQuery] = useState("");
  const [libraryWorking, setLibraryWorking] = useState(false);
  const [storageWorking, setStorageWorking] = useState(false);
  const busy = libraryWorking || storageWorking;
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  const heading = useRef<HTMLHeadingElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pendingTarget = useRef<string | null>(null);
  const active = section ?? "general";
  const sections = [
    { id: "general", label: t("通用"), description: t("语言、字体、阅读与布局"), icon: Settings2, group: t("偏好设置") },
    { id: "libraries", label: t("资料库管理"), description: t("创建、添加与切换资料库"), icon: FolderOpen, group: t("资料与存储") },
    { id: "storage", label: t("存储位置"), description: t("保存路径与自动保存"), icon: HardDrive, group: t("资料与存储") },
    { id: "backup", label: t("备份与恢复"), description: t("导出备份与恢复资料"), icon: Download, group: t("资料与存储") },
    { id: "history", label: t("历史版本"), description: t("查看与恢复历史记录"), icon: History, group: t("资料与存储") },
    { id: "plugins", label: t("插件与集成"), description: t("管理插件与外部连接"), icon: Plug, group: t("应用") },
    { id: "ai", label: t("AI 服务"), description: t("自配 API 地址、密钥与模型"), icon: AiMascot, group: t("应用") },
    { id: "about", label: t("关于觅维"), description: t("版本、帮助与开源信息"), icon: Info, group: t("应用") },
  ] as const;
  const current = sections.find(item => item.id === active)!;
  const searchable = [
    { id: "setting-language", section: "general", title: t("界面语言"), description: t("简体中文或 English，保留笔记原文。"), keywords: "language locale 中文 English" },
    { id: 'setting-font', section: 'general', title: t('界面字体'), description: t('选择字体，分别调整界面与正文的字号。'), keywords: 'font size typography appearance TTF OTF WOFF WOFF2 字体 字号 大小 外观 排版' },
    { id: "setting-mode", section: "general", title: t("笔记模式"), description: t("选择只读查看或编辑模式。"), keywords: "editor read edit 编辑 阅读 只读" },
    { id: "setting-panels", section: "general", title: t("侧栏显示"), description: t("显示左侧导航与右侧大纲。"), keywords: "sidebar outline navigation 布局 面板 大纲 导航" },
    { id: "setting-libraries", section: "libraries", title: t("资料库管理"), description: t("新建、添加、切换、改名或从列表移除资料库。"), keywords: "library workspace create rename switch WebBench 资料库" },
    { id: "setting-storage", section: "storage", title: t("本地保存路径"), description: t("检查保存目录，迁移当前资料或打开已有资料库。"), keywords: "storage folder path save migration assets 自动保存 附件 路径 目录" },
    { id: "setting-backup", section: "backup", title: t("完整备份与恢复"), description: t("导出 JSON、含附件 ZIP 备份，或预览并恢复已有备份。"), keywords: "export import backup restore zip json 导出 导入 备份 恢复 附件" },
    { id: "setting-history", section: "history", title: t("历史版本"), description: t("查看最近 30 个已校验版本，预览后恢复。"), keywords: "history version revision restore rollback 历史 恢复 版本" },
    { id: "setting-plugins", section: "plugins", title: t("插件与集成"), description: t("安装、启用、停用或卸载插件，查看外部程序连接。"), keywords: "plugin integration WebBench replay 插件 集成 连接 回放" },
    { id: "setting-ai", section: "ai", title: t("AI 服务"), description: t("配置服务商、API Key、接口类型和模型，测试连接与工具能力。"), keywords: "AI API key provider model agent 大模型 人工智能 密钥 地址" },
    { id: "setting-about", section: "about", title: t("关于觅维"), description: t("查看版本、使用手册与项目主页。"), keywords: "about version help manual license source MeWiki 觅维 关于 版本 手册 帮助 开源 许可" },
  ] as const;
  const searching = query.trim().length > 0;
  const results = searchSettings(searchable, query);
  const libraryScoped = ["storage", "backup", "history"].includes(active);

  useEffect(() => {
    if (!section) return;
    content.current?.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, [section]);
  useEffect(() => {
    if (!section) return;
    const oldTitle = document.title;
    document.title = `${t("设置")} · ${t("觅维")}`;
    return () => { document.title = /^(MeWiki|觅维)$/.test(oldTitle) ? t("觅维") : oldTitle; };
  }, [section, current.label]);
  useEffect(() => {
    if (!pendingTarget.current || searching || !section) return;
    const target = document.getElementById(pendingTarget.current);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "start" });
    pendingTarget.current = null;
  }, [searching, section]);
  useEffect(() => {
    if (!busy) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [busy]);

  return <section className="mewiki-settings-page" data-testid="mewiki-settings-page" aria-label={t("应用设置")} hidden={!section}>
    <header className="mewiki-settings-topbar">
      <button type="button" data-ui="icon-action" className="mewiki-settings-back" onClick={() => { setQuery(""); closeSettings(); }} disabled={busy} aria-label={t("返回笔记")} title={t("返回笔记")}><ArrowLeft size={17} /></button>
      <h1>{t("设置")}</h1>
      <div className="mewiki-settings-search" role="search">
        <Search size={16} aria-hidden="true" />
        <input ref={search} type="search" data-ui="search-input" aria-label={t("搜索设置")} placeholder={t("搜索设置…")} value={query} disabled={busy} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape" && query) { event.preventDefault(); event.stopPropagation(); setQuery(""); } }} />
        {query && <button type="button" aria-label={t("清除搜索")} title={t("清除搜索")} onClick={() => { setQuery(""); search.current?.focus(); }}><X size={14} /></button>}
      </div>
    </header>
    <aside className="mewiki-settings-sidebar">
      <div className="mewiki-settings-brand"><img src="/brand/mewiki-app-icon.svg?v=20261120-me-palette" alt="" width={28} height={28} draggable={false} /><strong>{t("觅维")}</strong></div>
      <nav aria-label={t("设置分类")}>
        {[...new Set(sections.map(item => item.group))].map(group => <div className="mewiki-settings-nav-group" key={group}>
          <p>{group}</p>
          {sections.filter(item => item.group === group).map(item => <a key={item.id} href={buildSettingsUrl(new URL(location.href), item.id)} aria-current={!searching && active === item.id ? "page" : undefined} aria-disabled={busy || undefined} onClick={event => {
            if (busy) { event.preventDefault(); return; }
            if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault(); setQuery(""); openSettings(item.id);
          }}><item.icon size={17} /><span>{item.label}</span></a>)}
        </div>)}
      </nav>
      <div className="mewiki-settings-library" aria-label={t("当前资料库")}><FolderOpen size={16} /><strong title={workspace.profile.name}>{workspace.profile.name}</strong></div>
    </aside>
    <div className="mewiki-settings-mobile-nav"><label htmlFor="mewiki-settings-category">{t("设置分类")}</label><select id="mewiki-settings-category" value={active} disabled={busy} onChange={event => { setQuery(""); openSettings(event.target.value as SettingsSection); }}>{sections.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
    <div ref={content} className="mewiki-settings-content">
      <div className="mewiki-settings-content-inner">
        <header className="mewiki-settings-page-heading">
          <h2 ref={heading} tabIndex={-1}>{searching ? t("搜索结果") : current.label}</h2>
          {searching && <p role="status">{t`找到 ${results.length} 项设置`}</p>}
        </header>
        {searching && <div className="mewiki-settings-results">
          {results.length ? <ul>{results.map(item => <li key={item.id}><button type="button" onClick={() => { pendingTarget.current = item.id; setQuery(""); openSettings(item.section); }}>
            <div><small>{sections.find(section => section.id === item.section)?.label}</small><strong>{item.title}</strong><p>{item.description}</p></div><ChevronRight size={18} />
          </button></li>)}</ul> : <div className="mewiki-settings-empty"><SearchX size={32} /><h3>{t("未找到匹配的设置")}</h3><p>{t("试试“语言”“备份”或“插件”等关键词。")}</p><button type="button" onClick={() => { setQuery(""); search.current?.focus(); }}>{t("清除搜索")}</button></div>}
        </div>}
        <div hidden={searching}>
          {libraryScoped && <div className="mewiki-settings-scope"><FolderOpen size={17} /><span>{t("当前资料库")}<strong>{workspace.profile.name}</strong></span><button type="button" disabled={busy} onClick={() => openSettings("libraries")}>{t("切换资料库")}<ChevronRight size={14} /></button></div>}
          <div hidden={active !== "general"}>
            <SettingsGroup title={t("界面语言")} description={t('跟随浏览器首次选择；切换不会翻译笔记内容。')} id="setting-language"><LanguageSettings /></SettingsGroup>
            <SettingsGroup title={t('界面字体')} id="setting-font"><InterfaceFontSettings /></SettingsGroup>
            <SettingsGroup title={t("阅读与布局")} description={t("适用于此窗口，并在此浏览器中记住你的选择。")}>
              <div className="mewiki-setting-row" id="setting-mode" tabIndex={-1}><label htmlFor="mewiki-setting-mode"><strong>{t("笔记模式")}</strong></label><select id="mewiki-setting-mode" value={readOnly ? "read" : "edit"} onChange={event => onReadOnlyChange(event.target.value === "read")}><option value="read">{t("只读查看")}</option><option value="edit">{t("编辑模式")}</option></select></div>
              <div id="setting-panels" tabIndex={-1}>
                <label className="mewiki-setting-row mewiki-setting-switch"><span><strong>{t("左侧导航")}</strong></span><input type="checkbox" role="switch" checked={!sidebarCollapsed} onChange={event => onSidebarCollapsedChange(!event.target.checked)} aria-label={t("显示左侧导航")} /></label>
                <label className="mewiki-setting-row mewiki-setting-switch"><span><strong>{t("右侧大纲")}</strong></span><input type="checkbox" role="switch" checked={!outlineCollapsed} onChange={event => onOutlineCollapsedChange(!event.target.checked)} aria-label={t("显示右侧大纲")} /></label>
              </div>
            </SettingsGroup>
          </div>
          <div hidden={active !== "libraries"} id="setting-libraries" tabIndex={-1}><LibraryManager onClose={closeSettings} onBusyChange={setLibraryWorking} /></div>
          <div hidden={!libraryScoped}><ResearchLibraryStorage library={library} section={active} onBusyChange={setStorageWorking} /></div>
          <div hidden={active !== "plugins"} id="setting-plugins" tabIndex={-1}><PluginManager /></div>
          {active === 'ai' && section && <div id="setting-ai" tabIndex={-1}><AiServiceSettings /></div>}
          <div hidden={active !== "about"} id="setting-about" tabIndex={-1}>
            <div className="mewiki-settings-about"><img className="mewiki-settings-app-icon" src="/brand/mewiki-app-icon.svg?v=20261120-me-palette" alt="" width={60} height={60} draggable={false} /><div><h3>{t("觅维")}</h3><span>{t`版本 ${import.meta.env.MEWIKI_APP_VERSION}`}</span></div><p>{t("寻觅知识，以多维链接万物。")}</p></div>
            <SettingsGroup title={t("帮助与开源")}>
              <button className="mewiki-setting-link" type="button" onClick={() => { closeSettings(); onOpenHelp?.(); }}><BookOpen size={18} /><span><strong>{t("使用手册")}</strong></span><ChevronRight size={17} /></button>
              <a className="mewiki-setting-link" href="https://github.com/tojayon/MeWiki" target="_blank" rel="noopener noreferrer"><Info size={18} /><span><strong>{t("项目主页")}</strong></span><ArrowUpRight size={17} /></a>
              <div className="mewiki-setting-row"><span><strong>{t("开源许可")}</strong><small>{t("觅维以 MIT 许可发布。第三方组件遵循各自许可。")}</small></span><a href="https://github.com/tojayon/MeWiki/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">MIT<ArrowUpRight size={14} /></a></div>
            </SettingsGroup>
            <div className="mewiki-settings-local-note"><HardDrive size={18} /><p>{t("笔记和附件保存在你选择的资料库中。通过备份与恢复，可以将完整资料迁移到其他设备。")}</p></div>
          </div>
        </div>
        {(library.error || library.cacheError) && !libraryScoped && <p className="research-storage-error" role="alert">{localizeError(library.error || library.cacheError)}<button type="button" onClick={() => openSettings("storage")}>{t("检查保存状态")}</button></p>}
        {busy && <p className="mewiki-settings-operation" role="status">{t("操作进行中，请等待完成后再离开设置。")}</p>}
      </div>
    </div>
    <footer className="mewiki-settings-footer"><span><PanelLeft size={14} />{workspace.profile.name}</span><span data-save-status={library.status}>{librarySaveLabel(library)}</span></footer>
  </section>;
}
