import { useLocale } from "../i18n/react.ts";
import { t } from "../i18n/locale.ts";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import type { ResearchOutlineHeading } from "../domain/researchOutline.ts";
import "./ResearchOutline.css";
import { FileText } from "lucide-react";
import type { ResearchNote } from "../domain/researchNotebook.ts";
import { buildResearchNoteBacklinks } from "../domain/researchNoteLinks.ts";
import { getNoteLibrary } from "../domain/researchNoteLibraries.ts";

export default function ResearchOutline({ headings, contentRef, onNavigate, onClose, notes, noteId, contentId, onOpenNote, recipe, recipeActive = false, onRecipeActiveChange, aiPanel, aiActive = false, onAiActiveChange, contentAvailable = true }: {
  headings: readonly ResearchOutlineHeading[];
  contentRef: RefObject<HTMLDivElement | null>;
  onNavigate: (heading: ResearchOutlineHeading) => void;
  onClose: () => void;
  notes?: readonly ResearchNote[];
  noteId?: string;
  contentId?: string;
  onOpenNote?: (id: string, blockId: string) => void;
  recipe?: ReactNode;
  recipeActive?: boolean;
  onRecipeActiveChange?: (active: boolean) => void;
  aiPanel?: ReactNode;
  aiActive?: boolean;
  onAiActiveChange?: (active: boolean) => void;
  contentAvailable?: boolean;
}) {
  useLocale();
  const [tab, setTab] = useState<"outline" | "backlinks">("outline");
  const backlinks = useMemo(() => notes && noteId ? buildResearchNoteBacklinks(notes, noteId) : [], [notes, noteId]);
  const [activeId, setActiveId] = useState<string | undefined>(headings[0]?.id);
  const clickedId = useRef<string | undefined>(undefined);
  const selected = headings.some(heading => heading.id === activeId) ? activeId : headings[0]?.id;

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    let frame = 0;
    const update = (root: Element) => {
      const bounds = root.getBoundingClientRect();
      const anchors = [...root.querySelectorAll<HTMLElement>("[data-outline-id]")]
        .filter(anchor => anchor.getClientRects().length && !anchor.closest("[inert]"));
      const clicked = anchors.find(anchor => anchor.dataset.outlineId === clickedId.current);
      if (clicked) {
        const rect = clicked.getBoundingClientRect();
        if (rect.bottom > bounds.top && rect.top < bounds.bottom) { setActiveId(clickedId.current); return; }
      }
      clickedId.current = undefined;
      const current = anchors.filter(anchor => anchor.getBoundingClientRect().top <= bounds.top + 36).at(-1) ?? anchors[0];
      if (current) setActiveId(current.dataset.outlineId);
    };
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      const root = event.target.closest(".research-note-scroll, .research-theory-drawer-content");
      if (!root || !content.contains(root)) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => update(root));
    };
    frame = requestAnimationFrame(() => {
      const root = content.querySelector(".research-note-scroll");
      if (root) update(root);
    });
    content.addEventListener("scroll", onScroll, true);
    return () => { cancelAnimationFrame(frame); content.removeEventListener("scroll", onScroll, true); };
  }, [headings, contentRef, contentId]);

  return <aside id="research-note-outline" className="research-note-outline" aria-label={aiActive ? t('AI 工作区') : t("文章大纲")} onKeyDown={event => {
    if (event.key !== "Escape") return;
    event.preventDefault(); event.stopPropagation(); onClose();
  }}>
    <header>{notes || onAiActiveChange ? <div className="research-outline-tabs" role="tablist" aria-label={t("笔记右侧面板")}>
      {contentAvailable && <>
      <button type="button" role="tab" aria-selected={!aiActive && !recipeActive && tab === "outline"} onClick={() => { setTab("outline"); onAiActiveChange?.(false); onRecipeActiveChange?.(false); }}>{t("大纲")}</button>
      <button type="button" role="tab" aria-selected={!aiActive && !recipeActive && tab === "backlinks"} onClick={() => { setTab("backlinks"); onAiActiveChange?.(false); onRecipeActiveChange?.(false); }}>{t("反向链接")}</button>
      {recipe && <button id="research-note-recipe-tab" type="button" role="tab" aria-selected={!aiActive && recipeActive} aria-controls="research-note-recipe-panel" onClick={() => onRecipeActiveChange?.(true)}>{t("变量配方")}</button>}
      </>}
      {onAiActiveChange && <button id="research-note-ai-tab" type="button" role="tab" aria-label={t('AI')} title={t('AI 工作区')} aria-selected={aiActive} aria-controls="research-note-ai-panel" onClick={() => onAiActiveChange(true)}>{t('AI')}</button>}
    </div> : <strong>{t("大纲")}</strong>}</header>
    {onAiActiveChange && <div id="research-note-ai-panel" className="research-outline-ai-panel" role="tabpanel" aria-labelledby="research-note-ai-tab" hidden={!aiActive}>{aiPanel}</div>}
    {recipe && <div id="research-note-recipe-panel" className="research-outline-recipe-panel" role="tabpanel" aria-labelledby="research-note-recipe-tab" hidden={!recipeActive || aiActive || !contentAvailable}>{recipe}</div>}
    {!recipeActive && !aiActive && contentAvailable && (tab === "outline" ? <>
    <nav aria-label={t("文章标题")}>
      {headings.length ? <ol>{headings.map(heading => <li key={heading.id}>
        <button type="button" style={{ "--outline-depth": heading.depth } as CSSProperties}
          aria-current={selected === heading.id ? "location" : undefined}
          title={`${heading.number} ${heading.text}`} onClick={() => {
            clickedId.current = heading.id; setActiveId(heading.id); onNavigate(heading);
          }}><span className="research-outline-number">{heading.number}</span>{" "}<span>{heading.text || t("未命名标题")}</span></button>
      </li>)}</ol> : <p className="research-outline-empty">{t("这篇文章还没有层级标题。")}<span>{t("使用 # 至 ###### 添加标题后，会在这里显示。")}</span></p>}
    </nav>
    <footer>{headings.length}  {t("个标题")}</footer>
    </> : <><nav aria-label={t("引用当前笔记的笔记")}>
      {backlinks.length ? <ol className="research-note-backlinks">{backlinks.map(link => {
        const source = notes?.find(note => note.id === link.noteId);
        return <li key={link.noteId}><button type="button" onClick={() => onOpenNote?.(link.noteId, link.blockId)}>
          <strong><FileText size={14} aria-hidden="true" />{source?.title || t("未命名笔记")}</strong>
          <small>{source && getNoteLibrary(source) === "foundation" ? t("基础理论") : t("研究记录")}</small><span>{link.excerpt}</span>
        </button></li>;
      })}</ol> : <p className="research-outline-empty">{t("暂无笔记引用此篇。")}<span>{t("在其他笔记中输入 @，即可插入指向这里的链接。")}</span></p>}
    </nav><footer>{backlinks.length}  {t("篇引用笔记")}</footer></>)}
  </aside>;
}
