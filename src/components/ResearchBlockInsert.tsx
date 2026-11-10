import { useLocale } from "../i18n/react.ts";
import { t } from "../i18n/locale.ts";
import { useEffect, useId, useImperativeHandle, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { ArrowDown, ArrowUp, AudioLines, BookOpen, BookmarkPlus, ChartNoAxesCombined, CheckSquare2, Code2, File, FileText, Film, Globe, Heading2, Image, List, ListChecks, ListOrdered, MessageSquare, Minus, MoreVertical, PanelsTopLeft, PencilRuler, Plus, Quote, RefreshCw, Search, Sigma, Square, Table2, Type, X } from "lucide-react";
import type { ResearchContentType } from "../domain/researchNotebook.ts";
import { theoryAreaLabels, type TheoryContentArea } from "../domain/researchTheorySections.ts";
import { useFormulaPopover } from "./useFormulaPopover.ts";
import type { ResearchBlockDragHandle } from "./useResearchBlockDrag.ts";
import "./ResearchBlockInsert.css";
import { useIntegration } from '../integrations/IntegrationContext.ts';

type BlockType = ResearchContentType;
export type BlockInsertPosition = "above" | "below";
export interface ResearchBlockInsertHandle { insertBelow: () => void }
type PickerMode = "actions" | "insert" | "change";

const insertionGroups = () => ([
  { name: "文本", items: [
    { type: "paragraph", label: "段落", description: "正文与行内数学公式", icon: Type },
    { type: "heading", label: "标题", description: "用 # 至 ###### 设置一至六级标题", icon: Heading2 },
    { type: "list", label: "列表", description: "并列要点与核对事项", icon: List },
    { type: "orderedList", label: "有序列表", description: "带编号的步骤与推导", icon: ListOrdered },
    { type: "taskList", label: "待办列表", description: "使用勾选标记管理事项", icon: ListChecks },
    { type: "quote", label: "引用", description: "支持多层引用与行内格式", icon: Quote },
  ] },
  { name: "内容", items: [
    { type: "examples", label: "标签页", description: "可命名、配色的横向分栏内容", icon: PanelsTopLeft },
    { type: "callout", label: "Callout 提示框", description: "嵌入标签并自定义颜色与边框", icon: MessageSquare },
    { type: "code", label: "代码块", description: "保留缩进并按语言高亮", icon: Code2 },
    { type: "table", label: "表格", description: "按列整理数据与对齐方式", icon: Table2 },
    { type: "divider", label: "分隔线", description: "分隔笔记内容", icon: Minus },
  ] },
  { name: "媒体", items: [
    { type: "image", label: "图片", description: "上传、粘贴、拖入或引用网络图片", icon: Image },
    { type: "audio", label: "音频", description: "上传或引用音频，支持进度、音量与倍速", icon: AudioLines },
    { type: "video", label: "视频", description: "上传或引用视频，支持封面与全屏播放", icon: Film },
  ] },
  { name: "数学", items: [
    { type: "formula", label: "公式", description: "连接符号词典的可视化公式", icon: Sigma },
  ] },
  { name: "文档与附件", items: [
    { type: "pdf", label: "PDF 文档", description: "阅读、翻页、搜索与引用指定页面", icon: FileText },
    { type: "file", label: "附件", description: "保存文档、表格、压缩包与其他原始文件", icon: File },
  ] },
  { name: "引用", items: [
    { type: 'noteEmbed', label: '引用笔记内容', description: '显示其他笔记的一个或多个内容块，随来源同步更新', icon: RefreshCw },
    { type: "bookmark", label: "网页链接", description: "带标题、摘要与来源的网页卡片", icon: Globe },
    { type: "citation", label: "文献引用", description: "作者、年份、DOI、阅读笔记与关联 PDF", icon: BookOpen },
  ] },
  { name: "数据与绘图", items: [
    { type: "dataset", label: "数据与图表", description: "导入 CSV、Excel 或粘贴数据，绘制折线、散点与柱图", icon: ChartNoAxesCombined },
    { type: "diagram", label: "绘图与流程图", description: "手绘草图、流程图、时序图与结构图", icon: PencilRuler },
  ] },
  { name: "研究证据", items: [
    { type: "evidence", label: "插入回放位置", description: "记录当前实验、时间与数据包", icon: BookmarkPlus },
  ] },
] satisfies { name: string; items: { type: BlockType; label: string; description: string; icon: typeof Type }[] }[]).map(group => ({ ...group, id: group.name, name: t(group.name), items: group.items.map(item => ({ ...item, label: t(item.label), description: t(item.description) })) }));

function InsertPopover({ trigger, mode, position, currentType, canInsertEvidence, canChangeType, onModeChange, onInsert, onChangeType, onClose, contentArea, chapter, onAreaChange }: {
  trigger: HTMLButtonElement;
  mode: PickerMode;
  position?: BlockInsertPosition;
  currentType?: BlockType;
  canInsertEvidence: boolean;
  canChangeType: boolean;
  onModeChange: (mode: PickerMode, position?: BlockInsertPosition) => void;
  onInsert: (type: BlockType, position?: BlockInsertPosition, provider?: string) => void;
  onChangeType: (type: BlockType) => void;
  onClose: (restoreFocus?: boolean) => void;
  contentArea?: TheoryContentArea;
  chapter?: boolean;
  onAreaChange?: (area: TheoryContentArea) => void;
}) {
  useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement>(trigger);
  const [query, setQuery] = useState("");
  const id = useId();
  const matches = query.trim().toLocaleLowerCase();
  const integration = useIntegration();
  const allGroups: { id: string; name: string; items: { type: BlockType; label: string; description: string; icon: typeof Type; provider?: string }[] }[] = [...insertionGroups(),
    ...(mode !== 'change' && integration.insertions.length ? [{ id: 'external', name: t('外部程序'), items: integration.insertions.map(item => ({ type: 'external' as const, ...item, icon: BookmarkPlus })) }] : [])];
  const groups = allGroups.map((group) => ({ ...group, items: group.items.filter((item) => (mode !== 'change' || item.type !== 'noteEmbed') && (item.type !== "evidence" || canInsertEvidence) && (group.name + item.label).toLocaleLowerCase().includes(matches)) })).filter((group) => group.items.length);
  useFormulaPopover({ ref, triggerRef, getAnchor: () => trigger.getBoundingClientRect(), onCancel: onClose, side: "right" });
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("input, button[data-menu-action]")?.focus({ preventScroll: true });
  }, [mode]);

  const handleKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    if ((event.key === "Home" || event.key === "End") && event.target instanceof HTMLInputElement) return;
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button[data-menu-action]:not(:disabled), button[data-insert-type]:not(:disabled)") ?? [])];
    if (!buttons.length) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const position = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : current < 0 ? (event.key === "ArrowDown" ? 0 : buttons.length - 1)
      : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[position].focus();
  };

  const chooseType = (type: BlockType, provider?: string) => {
    if (mode === "change") onChangeType(type);
    else onInsert(type, position, provider);
    onClose();
  };
  const dialogLabel = mode === "actions" ? t("内容块操作") : mode === "change" ? t("更改内容类型") : t("插入笔记内容");

  return <div ref={ref} className="research-block-insert-popover" data-mode={mode} popover="manual" role="dialog" aria-label={dialogLabel} onKeyDown={handleKeys}>
    {mode !== "actions" && <header><strong>{mode === "change" ? t("更改内容类型") : t("插入内容")}</strong><button data-ui="icon-action" aria-label={t("关闭内容操作")} onClick={() => onClose(true)} title={t("关闭内容操作")}><X size={14} /></button></header>}
    {mode === "actions" ? <div className="research-block-insert-actions">
      <button type="button" data-menu-action="above" onClick={() => onModeChange("insert", "above")}><ArrowUp size={15} /><span>{t("上方插入")}</span></button>
      <button type="button" data-menu-action="below" onClick={() => onModeChange("insert", "below")}><ArrowDown size={15} /><span>{t("下方插入")}</span></button>
      <button type="button" data-menu-action="change" disabled={!canChangeType} title={!canChangeType ? t("该公式仍存在来源关联，解除关联后才能更改类型") : undefined} onClick={() => onModeChange("change")}><RefreshCw size={15} /><span>{t("更改类型")}</span></button>
      {onAreaChange && <div className="research-block-section-options">
        <strong>{chapter ? t("分区 · 本节及下级内容") : t("内容分区")}</strong>
        {(["given", "conclusion", "derivation"] as const).map((area) => <button type="button" key={area} data-menu-action={`section-${area}`} aria-pressed={(contentArea ?? "derivation") === area}
          onClick={() => { onAreaChange(area); onClose(); }}>
          <span>{area === "derivation" ? t("放回推导过程") : t`设为${t(theoryAreaLabels[area])}`}</span>
        </button>)}
      </div>}
    </div> : <>
      <label className="research-block-insert-search"><Search size={14} /><input aria-label={mode === "change" ? t("搜索内容类型") : t("搜索插入内容")} placeholder={t("搜索内容类型…")} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="research-block-insert-options">
        {groups.map((group, index) => <div role="group" aria-labelledby={`${id}-${index}`} key={group.id}>
          <strong id={`${id}-${index}`} className="research-block-insert-category">{group.name}</strong>
          {group.items.map((item) => {
            const unavailable = item.type === "evidence" && !canInsertEvidence;
            const unchanged = mode === "change" && item.type === currentType;
            const disabled = unavailable || unchanged;
            const title = unchanged ? t("当前内容已经是此类型") : unavailable ? t("载入回放后可插入当前回放位置") : item.description;
            return <button key={item.provider ?? item.type} type="button" data-insert-type={item.type} data-provider={item.provider} aria-label={item.label} disabled={disabled}
              title={title} onClick={() => chooseType(item.type, item.provider)}>
              <span className="research-block-insert-icon"><item.icon size={17} /></span>
              <span><strong>{item.label}</strong><small>{unchanged ? t("当前类型") : unavailable ? t("载入回放后可使用") : item.description}</small></span>
            </button>;
          })}
        </div>)}
        {!groups.length && <p className="research-block-insert-empty">{t("没有匹配的内容类型")}</p>}
      </div>
    </>}
  </div>;
}

export default function ResearchBlockInsert({ ref, atEnd = false, currentType, canInsertEvidence, canChangeType = true, onInsert, onChangeType, contentArea, onAreaChange, insertionLabel, dragHandle }: {
  ref?: Ref<ResearchBlockInsertHandle>;
  atEnd?: boolean;
  currentType?: BlockType;
  canInsertEvidence: boolean;
  canChangeType?: boolean;
  onInsert: (type: BlockType, position?: BlockInsertPosition, provider?: string) => void;
  onChangeType?: (type: BlockType) => void;
  contentArea?: TheoryContentArea;
  onAreaChange?: (area: TheoryContentArea) => void;
  insertionLabel?: string;
  dragHandle?: ResearchBlockDragHandle;
}) {
  useLocale();
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const [mode, setMode] = useState<PickerMode>(atEnd ? "insert" : "actions");
  const [position, setPosition] = useState<BlockInsertPosition>();
  const buttonRef = useRef<HTMLButtonElement>(null);
  useImperativeHandle(ref, () => ({ insertBelow: () => {
    setPosition("below"); setMode("insert"); setTrigger(buttonRef.current);
  } }), []);
  const close = (restoreFocus = false) => { if (restoreFocus) trigger?.focus(); setTrigger(null); setMode(atEnd ? "insert" : "actions"); setPosition(undefined); };
  const chooseMode = (nextMode: PickerMode, nextPosition?: BlockInsertPosition) => { setPosition(nextPosition); setMode(nextMode); };
  return <div className="research-block-insert" data-open={!!trigger} data-at-end={atEnd}>
    <button ref={buttonRef} data-ui="icon-action" type="button" className="research-block-insert-trigger" aria-label={atEnd ? insertionLabel ?? t("在笔记末尾插入") : t("内容块操作")}
      title={atEnd ? insertionLabel ?? t("在笔记末尾添加内容") : dragHandle?.selecting ? t("点击选择或取消；按住选中的把手批量拖动；Shift 连选") : dragHandle ? t("点击打开菜单；按住拖动；Shift 连选、Ctrl/Cmd 多选；Alt+↑/↓ 排序") : t("内容块操作")}
      aria-haspopup={dragHandle?.selecting ? undefined : "dialog"} aria-expanded={dragHandle?.selecting ? undefined : !!trigger}
      aria-pressed={dragHandle?.selecting || dragHandle?.selected ? dragHandle.selected : undefined}
      data-research-drag-handle={dragHandle ? true : undefined}
      aria-keyshortcuts={dragHandle ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
      onPointerDown={dragHandle ? (event) => dragHandle.onPointerDown(event, () => close()) : undefined}
      onClickCapture={dragHandle?.onClickCapture}
      onKeyDown={dragHandle?.onKeyDown}
      onClick={(event) => trigger ? close() : setTrigger(event.currentTarget)}>{atEnd ? <Plus size={16} /> : dragHandle?.selected ? <CheckSquare2 size={16} /> : dragHandle?.selecting ? <Square size={16} /> : <MoreVertical size={16} />}</button>
    {trigger && <InsertPopover key={`${trigger.dataset.blockId ?? "tail"}:${mode}`} trigger={trigger} mode={mode} position={position} currentType={currentType}
      canInsertEvidence={canInsertEvidence} canChangeType={canChangeType} onModeChange={chooseMode} onInsert={onInsert} onChangeType={onChangeType ?? (() => {})} onClose={close}
      contentArea={contentArea} chapter={currentType === "heading"} onAreaChange={onAreaChange} />}
  </div>;
}
