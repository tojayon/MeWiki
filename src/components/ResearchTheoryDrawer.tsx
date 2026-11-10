import { useLocale } from "../i18n/react.ts";
import { t } from "../i18n/locale.ts";
import { useId, type HTMLAttributes, type ReactNode } from "react";
import type { ResearchTheorySection } from "../domain/researchNotebook.ts";
import "./ResearchTheoryDrawer.css";

export default function ResearchTheoryDrawer({ section, active, open, onToggle, children, dragOver = false, resizeHandle }: {
  section: ResearchTheorySection;
  active: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  dragOver?: boolean;
  resizeHandle: HTMLAttributes<HTMLDivElement>;
}) {
  useLocale();
  const id = useId();
  const label = section === "given" ? t("条件") : t("结论");
  return <section className={`research-theory-drawer is-${section}`} data-active={active} data-open={open}
    aria-label={t`${label}抽屉`} aria-hidden={!active} inert={!active}>
    <button type="button" className="research-theory-drawer-toggle" data-research-drawer-tab={section}
      aria-label={`${open ? t("收起") : t("展开")}${label}`} aria-expanded={open} aria-controls={id} onClick={onToggle}>
      {label}
    </button>
    <div id={id} className="research-theory-drawer-content" aria-hidden={!open} inert={!open}
      data-research-drop-area={section} data-research-drop-active={dragOver}>
      <div className="research-theory-drawer-body">{children}</div>
    </div>
    <div {...resizeHandle} className="research-theory-drawer-resize" role="separator" tabIndex={0}
      aria-label={t`调整${label}面板高度`} aria-orientation="horizontal" aria-controls={id} hidden={!active || !open}
      title={t`拖动调整${label}面板高度，也可使用上下方向键；按住 Shift 加速`} />
  </section>;
}
