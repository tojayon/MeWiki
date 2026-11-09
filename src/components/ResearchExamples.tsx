import ExternalContentCard from '../integrations/ExternalContentCard.tsx';
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import ResearchRichBlock from "./ResearchRichBlock.tsx";
import { isResearchRichBlock } from "../domain/researchRichContent.ts";
import { ArrowLeft, ArrowRight, Plus, RotateCcw, Settings2, Trash2, X } from "lucide-react";
import { useDeleteConfirmation } from "./useDeleteConfirmation.ts";
import { createExampleTab, defaultTabsAppearance, normalizeTabsAppearance, researchTabsPresets, researchTabsTitle, type ResearchExampleTab, type ResearchExamplesBlock, type ResearchTabsAppearance, type ResearchTabsLabelPosition } from "../domain/researchExamples.ts";
import { normalizeCalloutColor } from "../domain/researchCallout.ts";
import { renderedFormulaTex, type ResearchNotebookBlock } from "../domain/researchNotebook.ts";
import type { ResearchSymbolEntry } from "../domain/researchDictionary.ts";
import type { ResearchExampleContainer } from "../domain/researchBlockTree.ts";
import ResearchMarkdown from "./ResearchMarkdown.tsx";
import ResearchCallout from "./ResearchCallout.tsx";
import ResearchMediaBlock from "./ResearchMediaBlock.tsx";
import ResearchBookmarkBlock from "./ResearchBookmarkBlock.tsx";
import { Formula } from "./Formula.tsx";
import { useFormulaPopover } from "./useFormulaPopover.ts";
import "./ResearchExamples.css";
import { noteEmbedBlockLabel } from '../domain/researchNoteEmbed.ts';

type TabsPatch = Partial<Pick<ResearchExamplesBlock, "title" | "labelPosition" | "appearance" | "tabs">>;

const colorFields = [
  ["borderColor", "边框颜色"], ["backgroundColor", "内容背景色"], ["headerBackground", "标签栏背景色"],
  ["labelColor", "徽标文字色"], ["accentColor", "选中标签颜色"],
] as const;

function tabsColorLuminance(color: string): number {
  const channels = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function tabsTextColor(background: string): string {
  return tabsColorLuminance(background) < 0.2 ? "#f1f5fb" : "#25364d";
}

function tabsLabelTextColor(appearance: ResearchTabsAppearance): string {
  const background = tabsColorLuminance(appearance.borderColor);
  const foreground = tabsColorLuminance(appearance.labelColor);
  const contrast = (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
  return contrast >= 4.5 ? appearance.labelColor : background > 0.179 ? "#000000" : "#ffffff";
}

function TabsColorField({ label, value, onChange }: { label: string; value: string; onChange: (color: string) => void }) {
  return <label className="research-tabs-color-field"><span>{label}</span><span>
    <input type="color" aria-label={label} value={value} onChange={event => onChange(event.target.value)} />
    <input key={value} type="text" aria-label={`${label} HEX`} defaultValue={value} maxLength={7} spellCheck={false}
      onBlur={event => {
        const color = normalizeCalloutColor(event.currentTarget.value, value);
        event.currentTarget.value = color;
        onChange(color);
      }} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) event.currentTarget.blur(); }} />
  </span></label>;
}

function ExampleSettings({ block, tab, index, count, canRemove, trigger, onPatch, onRename, onMove, onRemove, onClose }: {
  block: ResearchExamplesBlock;
  tab: ResearchExampleTab;
  index: number;
  count: number;
  canRemove: boolean;
  trigger: HTMLButtonElement;
  onPatch: (patch: TabsPatch) => void;
  onRename: (title: string) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  onClose: (restoreFocus?: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement>(trigger);
  const appearance = normalizeTabsAppearance(block.appearance);
  const patchAppearance = (next: ResearchTabsAppearance) => {
    if (Object.keys(defaultTabsAppearance).some(key => next[key as keyof ResearchTabsAppearance] !== appearance[key as keyof ResearchTabsAppearance])) onPatch({ appearance: next });
  };
  const changeColor = (key: keyof ResearchTabsAppearance, color: string) => patchAppearance({ ...appearance, [key]: color });
  const close = (restoreFocus = false) => {
    if (document.activeElement instanceof HTMLElement && ref.current?.contains(document.activeElement)) document.activeElement.blur();
    onClose(restoreFocus);
  };
  useFormulaPopover({ ref, triggerRef, getAnchor: () => trigger.getBoundingClientRect(), onCancel: close });
  useEffect(() => { ref.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true }); }, []);
  return <div ref={ref} popover="manual" className="research-example-settings" role="dialog" aria-label="标签页设置">
    <header><strong>标签页设置</strong><button type="button" data-ui="icon-action" aria-label="关闭标签页设置" title="关闭" onClick={() => close(true)}><X size={14} /></button></header>
    <label>显示名称<input aria-label="显示名称" defaultValue={researchTabsTitle(block) === "标签页" ? "" : researchTabsTitle(block)} placeholder="例如：举例、方案比较、分步推导"
      onBlur={event => {
        const title = event.currentTarget.value.trim() || "标签页";
        if (title !== researchTabsTitle(block)) onPatch({ title });
      }}
      onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) close(true); }} /></label>
    <label>名称位置<select aria-label="名称位置" value={block.labelPosition ?? "center"} onChange={event => {
      const labelPosition = event.currentTarget.value as ResearchTabsLabelPosition;
      if (labelPosition !== (block.labelPosition ?? "center")) onPatch({ labelPosition });
    }}>
      <option value="left">靠左</option><option value="center">居中</option><option value="right">靠右</option>
    </select></label>
    <fieldset className="research-tabs-appearance"><legend>面板配色</legend>
      <div className="research-tabs-presets" role="group" aria-label="配色预设">
        {researchTabsPresets.map(preset => <button type="button" key={preset.name} aria-label={`${preset.name}配色`}
          aria-pressed={Object.keys(defaultTabsAppearance).every(key => appearance[key as keyof ResearchTabsAppearance] === preset.appearance[key as keyof ResearchTabsAppearance])}
          onClick={() => patchAppearance({ ...preset.appearance })}><i aria-hidden="true" style={{ backgroundColor: preset.appearance.borderColor }} />{preset.name}</button>)}
      </div>
      <div className="research-tabs-colors">{colorFields.map(([key, label]) => <TabsColorField key={key} label={label} value={appearance[key]} onChange={color => changeColor(key, color)} />)}</div>
      <button type="button" className="research-tabs-reset" onClick={() => patchAppearance({ ...defaultTabsAppearance })}><RotateCcw size={12} />恢复默认配色</button>
    </fieldset>
    <label>当前标签名称<input key={tab.id} aria-label="当前标签名称" defaultValue={/^标签 \d+$/.test(tab.title) ? "" : tab.title} placeholder={`标签 ${index + 1}`}
      onBlur={event => {
        if (!event.currentTarget.value && /^标签 \d+$/.test(tab.title)) return;
        onRename(event.currentTarget.value.trim() || `标签 ${index + 1}`);
      }}
      onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) close(true); }} /></label>
    <div className="research-example-order">
      <button type="button" aria-label="向左移动标签" disabled={index === 0} onClick={() => onMove(-1)}><ArrowLeft size={14} />左移</button>
      <button type="button" aria-label="向右移动标签" disabled={index === count - 1} onClick={() => onMove(1)}><ArrowRight size={14} />右移</button>
    </div>
    <button type="button" className="research-example-delete" aria-label="删除当前标签" disabled={count < 2 || !canRemove} title={count < 2 ? "至少保留一个标签" : !canRemove ? "此标签中有公式结果仍被引用，请先解除来源关联" : "删除当前标签及其内容"} onClick={onRemove}><Trash2 size={14} />删除当前标签</button>
  </div>;
}

function readBlock(block: ResearchNotebookBlock, symbols?: ResearchSymbolEntry[]): ReactNode {
  if (block.type === 'external') return <ExternalContentCard block={block} />;
  if (isResearchRichBlock(block)) return <ResearchRichBlock block={block} readOnly onPatch={() => {}} />;
  if (block.type === "examples") return <ResearchExamples block={block} readOnly symbols={symbols} />;
  if (block.type === "callout") return <ResearchCallout block={block} readOnly onPatch={() => {}} />;
  if (block.type === "formula") return <><Formula tex={symbols ? renderedFormulaTex(block, symbols).tex : block.tex} block />{block.caption && <ResearchMarkdown text={block.caption} />}{block.conditions && <ResearchMarkdown text={block.conditions} />}</>;
  if (block.type === "media") return <ResearchMediaBlock block={block} readOnly onPatch={() => {}} />;
  if (block.type === "bookmark") return <ResearchBookmarkBlock block={block} readOnly onPatch={() => {}} />;
  if (block.type === "evidence") return <div className="research-evidence-block"><strong>{block.runTitle}</strong><span>t = {block.time.toFixed(6)} s</span>{block.note && <ResearchMarkdown text={block.note} />}</div>;
  const text = block.type === 'noteEmbed' ? noteEmbedBlockLabel(block) : block.type === "list" ? block.items.map(item => `- ${item}`).join("\n") : block.type === "heading" ? `${"#".repeat(block.level)} ${block.text}` : block.text;
  return <div className="research-markdown"><ResearchMarkdown text={text} /></div>;
}

export default function ResearchExamples({ block, readOnly, onPatch, renderBlocks, selectedTabId, onSelect, canRemoveTab, dropTabId, symbols }: {
  block: ResearchExamplesBlock;
  readOnly: boolean;
  onPatch?: (patch: TabsPatch) => void;
  renderBlocks?: (blocks: ResearchNotebookBlock[], container: ResearchExampleContainer) => ReactNode;
  selectedTabId?: string;
  onSelect?: (tabId: string) => void;
  canRemoveTab?: (tab: ResearchExampleTab) => boolean;
  dropTabId?: string;
  symbols?: ResearchSymbolEntry[];
}) {
  const id = useId();
  const confirmDelete = useDeleteConfirmation();
  const latest = useRef({ block, onPatch, canRemoveTab });
  useLayoutEffect(() => { latest.current = { block, onPatch, canRemoveTab }; }, [block, onPatch, canRemoveTab]);
  const title = researchTabsTitle(block);
  const appearance = normalizeTabsAppearance(block.appearance);
  const contentInk = tabsTextColor(appearance.backgroundColor);
  const headerInk = tabsTextColor(appearance.headerBackground);
  const style = {
    "--research-tabs-border": appearance.borderColor, "--research-tabs-background": appearance.backgroundColor,
    "--research-tabs-header": appearance.headerBackground,
    "--research-tabs-label-color": tabsLabelTextColor(appearance), "--research-tabs-accent": appearance.accentColor,
    "--research-tabs-text": contentInk, "--research-tabs-header-ink": headerInk,
    "--research-tabs-header-active-ink": headerInk === "#f1f5fb" ? headerInk : appearance.accentColor,
    "--research-tabs-active-ink": contentInk === "#f1f5fb" ? contentInk : appearance.accentColor,
    "--research-tabs-link": contentInk === "#f1f5fb" ? "#b4d0ff" : "#1547c0",
    "--research-tabs-action-ink": contentInk === "#f1f5fb" ? contentInk : "#000",
    "--research-tabs-header-action-ink": headerInk === "#f1f5fb" ? headerInk : "#172033",
    "--research-tabs-header-action-accent": headerInk === "#f1f5fb" ? headerInk : "#1547c0",
  } as CSSProperties;
  const ref = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const storageKey = `mewiki:research-example-tab:${block.id}`;
  const [selectedId, setSelectedId] = useState(() => {
    try { return localStorage.getItem(storageKey); } catch { return null; }
  });
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const active = block.tabs.find(tab => tab.id === (selectedTabId ?? selectedId)) ?? block.tabs[0];
  const index = block.tabs.indexOf(active);
  const closeSettings = (restoreFocus = false) => { if (restoreFocus) trigger?.focus({ preventScroll: true }); setTrigger(null); };
  const select = (tabId: string, focus = false) => {
    setSelectedId(tabId);
    onSelect?.(tabId);
    try { localStorage.setItem(storageKey, tabId); } catch { /* Selection is still usable when browser storage is unavailable. */ }
    requestAnimationFrame(() => {
      const tab = [...(stripRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])].find(element => element.dataset.exampleId === tabId);
      if (focus) tab?.focus({ preventScroll: true });
    });
  };
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    // Scroll only the tab strip; restoring a selection must not move the note vertically.
    const reveal = () => {
      const button = [...strip.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(element => element.dataset.exampleId === active.id);
      if (!button) return;
      const tabBounds = button.getBoundingClientRect(), bounds = strip.getBoundingClientRect();
      if (tabBounds.left < bounds.left) strip.scrollLeft -= Math.ceil(bounds.left - tabBounds.left);
      else if (tabBounds.right > bounds.right) strip.scrollLeft += Math.ceil(tabBounds.right - bounds.right);
    };
    reveal();
    const resize = new ResizeObserver(reveal);
    resize.observe(strip);
    try { localStorage.setItem(storageKey, active.id); } catch { /* The in-memory selection still works. */ }
    return () => resize.disconnect();
  }, [active.id, block.tabs, storageKey]);
  const handleKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? block.tabs.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + block.tabs.length) % block.tabs.length;
    select(block.tabs[next].id, true);
  };
  const add = () => {
    let number = block.tabs.length + 1;
    while (block.tabs.some(tab => tab.title === `标签 ${number}`)) number++;
    const tab = createExampleTab(`标签 ${number}`);
    onPatch?.({ tabs: [...block.tabs, tab] });
    select(tab.id);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(":scope > .research-example-body .research-example-start")?.focus({ preventScroll: true }));
  };
  const move = (direction: -1 | 1) => {
    const next = [...block.tabs];
    const destination = index + direction;
    if (destination < 0 || destination >= next.length) return;
    [next[index], next[destination]] = [next[destination], next[index]];
    onPatch?.({ tabs: next });
  };
  const remove = () => {
    if (block.tabs.length < 2 || canRemoveTab?.(active) === false) return;
    confirmDelete({ title: "删除标签页", description: `确定删除标签“${active.title}”及其中的全部内容吗？` }, () => {
      const current = latest.current;
      const removed = current.block.tabs.find(tab => tab.id === active.id);
      if (!removed || current.block.tabs.length < 2 || current.canRemoveTab?.(removed) === false) return;
      const currentIndex = current.block.tabs.indexOf(removed);
      const next = current.block.tabs.filter(tab => tab.id !== active.id);
      closeSettings();
      current.onPatch?.({ tabs: next });
      select(next[Math.min(currentIndex, next.length - 1)].id, true);
    });
  };

  return <div ref={ref} className="research-examples" style={style} role="group" aria-label="标签页">
    <strong className="research-examples-label" data-label-position={block.labelPosition ?? "center"} title={title}><span>{title}</span></strong>
    <header className="research-examples-header">
      <div ref={stripRef} className="research-examples-tabs" role="tablist" aria-label="标签切换" onKeyDown={handleKeys}>
        {block.tabs.map((tab, tabIndex) => <button key={tab.id} id={`${id}-tab-${tabIndex}`} type="button" role="tab" data-example-id={tab.id}
          aria-selected={tab.id === active.id} aria-controls={`${id}-panel`} tabIndex={tab.id === active.id ? 0 : -1}
          data-research-example-tab data-research-example-block-id={block.id} data-research-example-tab-id={tab.id}
          data-research-drop-active={dropTabId === tab.id || undefined}
          title={tab.title} onClick={() => select(tab.id)}><span>{tab.title}</span></button>)}
      </div>
      {!readOnly && <div className="research-examples-actions">
        <button type="button" data-ui="icon-action" aria-label="添加标签" title="添加标签" onClick={add}><Plus size={14} /></button>
        <button type="button" data-ui="icon-action" aria-label="标签页设置" title="显示名称、名称位置、配色与当前标签设置" aria-expanded={!!trigger}
          onClick={event => setTrigger(trigger ? null : event.currentTarget)}><Settings2 size={14} /></button>
      </div>}
    </header>
    <div className="research-example-body" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${index}`} tabIndex={readOnly ? 0 : undefined}
      data-research-drop-area={renderBlocks ? "example" : undefined} data-research-example-block-id={block.id} data-research-example-tab-id={active.id}
      data-research-drop-active={dropTabId === active.id || undefined}>
      {renderBlocks ? renderBlocks(active.blocks, { exampleBlockId: block.id, tabId: active.id })
        : active.blocks.length ? <div className="research-example-read-blocks">{active.blocks.map(child => <section key={child.id} className={`research-example-read-block is-${child.type}`}>{readBlock(child, symbols)}</section>)}</div>
        : <p className="research-example-empty">此标签尚未填写。</p>}
    </div>
    {!readOnly && trigger && <ExampleSettings block={block} tab={active} index={index} count={block.tabs.length} canRemove={canRemoveTab?.(active) !== false} trigger={trigger}
      onPatch={patch => onPatch?.(patch)}
      onRename={title => onPatch?.({ tabs: block.tabs.map(tab => tab.id === active.id ? { ...tab, title } : tab) })}
      onMove={move} onRemove={remove} onClose={closeSettings} />}
  </div>;
}
