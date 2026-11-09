import { useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
import { normalizeResearchTags, type ResearchTagBranch, type ResearchTaggedItem } from "../domain/researchTags.ts";
import "./ResearchNoteManagement.css";

const branchKey = (path: string) => path ? `tag:${path.toLocaleLowerCase()}` : "untagged";
function loadCollapsed(storageKey: string): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    if (Array.isArray(value)) return new Set(value.filter((path): path is string => typeof path === "string"));
  } catch { /* Folding still works when browser storage is unavailable. */ }
  return new Set();
}

export default function ResearchTagTree<T extends ResearchTaggedItem>({
  branches, activeId, activeTags, filtering, filterKey, storageKey, label, renderItem, empty, revealActiveOnMount = false,
}: {
  branches: ResearchTagBranch<T>[];
  activeId: string;
  activeTags: string[] | undefined;
  filtering: boolean;
  filterKey: string;
  storageKey: string;
  label: string;
  renderItem: (item: T) => ReactNode;
  empty: ReactNode;
  revealActiveOnMount?: boolean;
}) {
  const id = useId();
  const tags = normalizeResearchTags(activeTags);
  const tagSignature = JSON.stringify(tags);
  const activeAncestors = () => new Set(tags.length ? tags.flatMap(tag => tag.split('/').map((_part, index, parts) => branchKey(parts.slice(0, index + 1).join('/')))) : [branchKey('')]);
  const [navigation, setNavigation] = useState(() => {
    const ancestors = revealActiveOnMount ? activeAncestors() : new Set<string>();
    return { activeId, tagSignature, collapsed: new Set([...loadCollapsed(storageKey)].filter(key => !ancestors.has(key))) };
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

  const toggle = (key: string) => {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    if (filtering) setFilteredView({ signature: filterKey, collapsed: next });
    else setNavigation({ ...navigation, collapsed: next });
  };
  const visibleDepth = (items: ResearchTagBranch<T>[]): number => items.reduce((maximum, branch) => Math.max(maximum, 1 + (collapsed.has(branchKey(branch.path)) ? 0 : visibleDepth(branch.children))), 0);
  const renderBranch = (branch: ResearchTagBranch<T>, depth: number): ReactNode => {
    const key = branchKey(branch.path);
    const open = !collapsed.has(key);
    const childrenId = `${id}-${encodeURIComponent(key)}`;
    return <li className="research-note-tree-branch" key={key} data-tag-path={branch.path}>
      <button type="button" className="research-note-folder" data-leaf={branch.children.length === 0}
        style={{ "--research-tag-depth": depth } as CSSProperties}
        aria-label={`${open ? "收起" : "展开"}标签 ${branch.path || "未分类"}`} aria-expanded={open} aria-controls={childrenId}
        title={branch.path || "未分类"} onClick={() => toggle(key)}>
        <span className="research-note-folder-content"><span className="research-note-folder-label">{branch.label}</span></span>
      </button>
      <ul id={childrenId} className="research-note-tree-children" hidden={!open}>
        {branch.items.map(item => <li className="research-note-tree-note" key={item.id}>{renderItem(item)}</li>)}
        {branch.children.map(child => renderBranch(child, depth + 1))}
      </ul>
    </li>;
  };
  return <nav className="research-note-tree-nav" aria-label={label}>
    <ul className="research-note-tree" style={{ "--research-note-tree-depth": Math.max(1, visibleDepth(branches)) } as CSSProperties}>
      {branches.map(branch => renderBranch(branch, 0))}
    </ul>
    {!branches.length && empty}
  </nav>;
}
