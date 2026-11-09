import { useRef, useState } from "react";
import { RotateCcw, Settings2, X } from "lucide-react";
import { defaultCalloutAppearance, normalizeCalloutAppearance, normalizeCalloutColor, type CalloutAppearance, type ResearchCalloutBlock } from "../domain/researchCallout.ts";
import ResearchTextBlock from "./ResearchTextBlock.tsx";
import { useFormulaPopover } from "./useFormulaPopover.ts";
import "./ResearchCallout.css";

const borderStyles = [
  { value: "solid", label: "实线", dashes: undefined },
  { value: "dashed", label: "虚线", dashes: "5 3" },
  { value: "dashdot", label: "点划线", dashes: "7 3 1 3" },
] as const;

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (color: string) => void }) {
  return <label className="research-callout-color-field">
    <span>{label}</span>
    <span className="research-callout-color-inputs">
      <input type="color" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />
      <input key={value} type="text" aria-label={`${label} HEX`} defaultValue={value} maxLength={7} spellCheck={false}
        onBlur={(event) => {
          const color = normalizeCalloutColor(event.currentTarget.value, value);
          event.currentTarget.value = color;
          onChange(color);
        }}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
    </span>
  </label>;
}

function CalloutSettings({ block, trigger, onPatch, onClose }: {
  block: ResearchCalloutBlock;
  trigger: HTMLButtonElement;
  onPatch: (patch: Partial<Pick<ResearchCalloutBlock, "title" | "text" | "appearance">>) => void;
  onClose: (restoreFocus?: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement>(trigger);
  const close = (restoreFocus = false) => {
    // Outside dismissal happens on pointerdown, before the browser fires blur.
    if (document.activeElement instanceof HTMLElement && ref.current?.contains(document.activeElement)) document.activeElement.blur();
    onClose(restoreFocus);
  };
  useFormulaPopover({ ref, triggerRef, getAnchor: () => trigger.getBoundingClientRect(), onCancel: close });
  const updateAppearance = (patch: Partial<CalloutAppearance>) => onPatch({ appearance: { ...block.appearance, ...patch } });
  return <div ref={ref} className="research-callout-settings" popover="manual" role="dialog" aria-label="Callout 设置">
    <header><strong>Callout 设置</strong><button type="button" data-ui="icon-action" aria-label="关闭 Callout 设置" title="关闭" onClick={() => close(true)}><X size={14} /></button></header>
    <label className="research-callout-title-field"><span>标签文字</span><input aria-label="标签文字" defaultValue={block.title === "提示" ? "" : block.title} placeholder="提示" onChange={(event) => onPatch({ title: event.target.value })} /></label>
    <div className="research-callout-label-colors">
      <ColorField label="标签背景色" value={block.appearance.labelBackground} onChange={(labelBackground) => updateAppearance({ labelBackground })} />
      <ColorField label="标签文字色" value={block.appearance.labelColor} onChange={(labelColor) => updateAppearance({ labelColor })} />
    </div>
    <div className="research-callout-border-settings">
      <div role="group" aria-label="边框线型" className="research-callout-line-field"><span>边框线型</span><div className="research-callout-border-options">
        {borderStyles.map((style) => <button key={style.value} type="button" aria-label={style.label} aria-pressed={block.appearance.borderStyle === style.value} onClick={() => updateAppearance({ borderStyle: style.value })}>
          <svg viewBox="0 0 44 8" aria-hidden="true"><line x1="1" y1="4" x2="43" y2="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray={style.dashes} /></svg><span>{style.label}</span>
        </button>)}
      </div></div>
      <div className="research-callout-border-values">
        <ColorField label="边框颜色" value={block.appearance.borderColor} onChange={(borderColor) => updateAppearance({ borderColor })} />
        <label className="research-callout-width-field"><span>边框粗细</span><span><input key={block.appearance.borderWidth} type="number" aria-label="边框粗细" min={0.5} max={6} step={0.5} defaultValue={block.appearance.borderWidth}
          onBlur={(event) => {
            const input = event.currentTarget;
            const borderWidth = normalizeCalloutAppearance({ ...block.appearance, borderWidth: input.valueAsNumber }).borderWidth;
            input.value = String(borderWidth);
            updateAppearance({ borderWidth });
          }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /><small>px</small></span></label>
      </div>
    </div>
    <footer><button type="button" className="research-callout-reset" onClick={() => onPatch({ appearance: { ...defaultCalloutAppearance } })}><RotateCcw size={12} />恢复默认样式</button></footer>
  </div>;
}

export default function ResearchCallout({ block, readOnly, onPatch, onComplete }: {
  block: ResearchCalloutBlock;
  readOnly: boolean;
  onPatch: (patch: Partial<Pick<ResearchCalloutBlock, "title" | "text" | "appearance">>) => void;
  onComplete?: () => void;
}) {
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const { appearance } = block;
  const width = appearance.borderWidth;
  const dasharray = appearance.borderStyle === "dashdot" ? `${7 * width} ${3 * width} ${width} ${3 * width}`
    : appearance.borderStyle === "dashed" ? `${5 * width} ${3 * width}` : undefined;
  const close = (restoreFocus = false) => { if (restoreFocus) trigger?.focus({ preventScroll: true }); setTrigger(null); };
  return <>
    <div className="research-callout">
      <svg className="research-callout-border" aria-hidden="true">
        <rect x={width / 2} y={width / 2} width={`calc(100% - ${width}px)`} height={`calc(100% - ${width}px)`} rx={Math.max(0, 4 - width / 2)} fill="none" stroke={appearance.borderColor} strokeWidth={width} strokeDasharray={dasharray} />
      </svg>
      <span className="research-callout-label" style={{ backgroundColor: appearance.labelBackground, color: appearance.labelColor }}>{block.title || "提示"}</span>
      <div className="research-callout-body"><ResearchTextBlock value={block.text} label="Callout 正文" kind="callout" readOnly={readOnly} onChange={(text) => onPatch({ text })} onComplete={onComplete} /></div>
    </div>
    {!readOnly && <button className="research-callout-settings-button" type="button" data-ui="icon-action" aria-label="Callout 设置" title="Callout 设置" aria-expanded={!!trigger} onClick={(event) => setTrigger(trigger ? null : event.currentTarget)}><Settings2 size={13} /></button>}
    {!readOnly && trigger && <CalloutSettings block={block} trigger={trigger} onPatch={onPatch} onClose={close} />}
  </>;
}
