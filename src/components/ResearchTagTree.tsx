import { useLocale } from "../i18n/react.ts";
import { t } from "../i18n/locale.ts";
import { useContext, useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { normalizeResearchTags, type ResearchTagBranch, type ResearchTaggedItem } from "../domain/researchTags.ts";
import { ResearchTagTreeToolbarContext } from "./ResearchTagTreeToolbarContext.ts";
import "./ResearchNoteManagement.css";

const branchKey = (path: string) => path ? `tag:${path.toLocaleLowerCase()}` : "untagged";
const itemsOnlyPreference = "view:items-only";
function setBranchCollapsed<T>(branch: ResearchTagBranch<T>, next: Set<string>, collapse: boolean) {
  if (collapse) next.add(branchKey(branch.path));
  else next.delete(branchKey(branch.path));
  branch.children.forEach(child => setBranchCollapsed(child, next, collapse));
}
function loadCollapsed(storageKey: string): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    if (Array.isArray(value)) return new Set(value.filter((path): path is string => typeof path === "string"));
  } catch { /* Folding still works when browser storage is unavailable. */ }
  return new Set();
}

export default function ResearchTagTree<T extends ResearchTaggedItem>({
  branches, preferenceBranches = branches, activeId, activeTags, filtering, filterKey, storageKey, label, renderItem, empty, revealActiveOnMount = false, showBulkToggle = false, keepTagsVisible = false,
}: {
  branches: ResearchTagBranch<T>[];
  preferenceBranches?: ResearchTagBranch<ResearchTaggedItem>[];
  activeId: string;
  activeTags: string[] | undefined;
  filtering: boolean;
  filterKey: string;
  storageKey: string;
  label: string;
  renderItem: (item: T) => ReactNode;
  empty: ReactNode;
  revealActiveOnMount?: boolean;
  showBulkToggle?: boolean;
  keepTagsVisible?: boolean;
}) {
  useLocale();
  const id = useId();
  const toolbar = useContext(ResearchTagTreeToolbarContext)?.target;
  const tags = normalizeResearchTags(activeTags);
  const tagSignature = JSON.stringify(tags);
  const activeAncestors = () => new Set(tags.length ? tags.flatMap(tag => tag.split('/').map((_part, index, parts) => branchKey(parts.slice(0, index + 1).join('/')))) : [branchKey('')]);
  const [navigation, setNavigation] = useState(() => {
    const saved = loadCollapsed(storageKey);
    if (keepTagsVisible && !saved.has(itemsOnlyPreference)) {
      // Expand legacy whole-branch folds once; later child overrides remain independent.
      const restore = (items: ResearchTagBranch<ResearchTaggedItem>[]) => items.forEach(branch => {
        if (saved.has(branchKey(branch.path))) setBranchCollapsed(branch, saved, true);
        else restore(branch.children);
      });
      restore(preferenceBranches);
      saved.add(itemsOnlyPreference);
    }
    const ancestors = revealActiveOnMount ? activeAncestors() : new Set<string>();
    return { activeId, tagSignature, collapsed: new Set([...saved].filter(key => !ancestors.has(key))) };
  });
  const [filteredView, setFilteredView] = useState<{ signature: string; collapsed: Set<string> } | null>(null);
  const collapsed = filtering ? filteredView?.signature === filterKey ? filteredView.collapsed : new Set<string>() : navigation.collapsed;

  if (navigation.activeId !== activeId || navigation.tagSignature !== tagSignature) {
    const ancestors = activeAncestors();
    setNavigation({ activeId, tagSignature, collapsed: new Set([...navigation.collapsed].filter(key => !ancestors.has(key))) });
    setFilteredView(null);
  }

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify([...navigation.collapsed])); }
    catch { /* Preserve navigation for this session if preferences cannot be saved. */ }
  }, [navigation.collapsed, storageKey]);

  const changeCollapsed = (next: Set<string>) => {
    if (filtering) setFilteredView({ signature: filterKey, collapsed: next });
    else setNavigation({ ...navigation, collapsed: next });
  };
  const hasVisibleEntries = (branch: ResearchTagBranch<T>): boolean =>
    (branch.items.length > 0 && !collapsed.has(branchKey(branch.path))) || branch.children.some(hasVisibleEntries);
  const toggle = (branch: ResearchTagBranch<T>) => {
    const key = branchKey(branch.path);
    const next = new Set(collapsed);
    if (keepTagsVisible) setBranchCollapsed(branch, next, hasVisibleEntries(branch));
    else if (next.has(key)) next.delete(key);
    else next.add(key);
    changeCollapsed(next);
  };
  const hasExpanded = branches.some(branch => keepTagsVisible ? hasVisibleEntries(branch) : !collapsed.has(branchKey(branch.path)));
  const toggleAll = () => {
    const next = new Set(collapsed);
    branches.forEach(branch => setBranchCollapsed(branch, next, hasExpanded));
    changeCollapsed(next);
  };
  const toggleLabel = hasExpanded ? t("全部折叠分类") : t("全部展开分类");
  const visibleDepth = (items: ResearchTagBranch<T>[]): number => items.reduce((maximum, branch) => Math.max(maximum, 1 + (!keepTagsVisible && collapsed.has(branchKey(branch.path)) ? 0 : visibleDepth(branch.children))), 0);
  const itemId = (branch: ResearchTagBranch<T>, item: T) => `${id}-${encodeURIComponent(branchKey(branch.path))}-item-${encodeURIComponent(item.id)}`;
  const controlledItems = (branch: ResearchTagBranch<T>): string[] => [...branch.items.map(item => itemId(branch, item)), ...branch.children.flatMap(controlledItems)];
  const renderBranch = (branch: ResearchTagBranch<T>, depth: number): ReactNode => {
    const key = branchKey(branch.path);
    const open = keepTagsVisible ? hasVisibleEntries(branch) : !collapsed.has(key);
    const childrenId = `${id}-${encodeURIComponent(key)}`;
    return <li className="research-note-tree-branch" key={key} data-tag-path={branch.path} data-tag-orientation={branch.children.length > 0 && (keepTagsVisible || open) ? "vertical" : "horizontal"}>
      <button type="button" className="research-note-folder" data-leaf={branch.children.length === 0}
        style={{ "--research-tag-depth": depth, "--research-tag-label-length": keepTagsVisible ? [...branch.label].length : 0 } as CSSProperties}
        aria-label={t`${open ? t("收起") : t("展开")}标签 ${branch.path || t("未分类")}`} aria-expanded={open} aria-controls={keepTagsVisible ? controlledItems(branch).join(" ") : childrenId}
        title={branch.path || t("未分类")} onClick={() => toggle(branch)}>
        <span className="research-note-folder-content"><span className="research-note-folder-label">{branch.path ? branch.label : t("未分类")}</span></span>
      </button>
      <ul id={childrenId} className="research-note-tree-children" hidden={!open && (!keepTagsVisible || !branch.children.length)}>
        {branch.items.map(item => <li id={itemId(branch, item)} className="research-note-tree-note" key={item.id} hidden={keepTagsVisible && collapsed.has(key)}>{renderItem(item)}</li>)}
        {branch.children.map(child => renderBranch(child, depth + 1))}
      </ul>
    </li>;
  };
  return <>
    {showBulkToggle && toolbar && createPortal(<button type="button" data-ui="icon-action" className="research-category-toggle"
      aria-label={toggleLabel} title={toggleLabel} aria-controls={`${id}-tree`} disabled={!branches.length}
      onKeyDown={event => event.stopPropagation()} onClick={toggleAll}>
      {hasExpanded ? <ChevronsDownUp size={16} aria-hidden="true" /> : <ChevronsUpDown size={16} aria-hidden="true" />}
    </button>, toolbar)}
    <nav id={`${id}-tree`} className="research-note-tree-nav" aria-label={label}>
      <ul className="research-note-tree" style={{ "--research-note-tree-depth": Math.max(1, visibleDepth(branches)) } as CSSProperties}>
        {branches.map(branch => renderBranch(branch, 0))}
      </ul>
      {!branches.length && empty}
    </nav>
  </>;
}
