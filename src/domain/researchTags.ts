export interface ResearchTaggedItem {
  id: string;
  tags?: string[];
}

export interface ResearchTagBranch<T> {
  path: string;
  label: string;
  count: number;
  items: T[];
  children: ResearchTagBranch<T>[];
}

export function normalizeResearchTags(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const unique = new Set<string>();
  return values.flatMap((value): string[] => {
    if (typeof value !== "string") return [];
    const tag = value.split("/").map(part => part.trim()).filter(Boolean).join("/");
    const key = tag.toLocaleLowerCase();
    if (!tag || unique.has(key)) return [];
    unique.add(key);
    return [tag];
  });
}

export function matchesResearchTag(path: string, filter: string) {
  const candidate = path.toLocaleLowerCase();
  const parent = filter.toLocaleLowerCase();
  return !parent || candidate === parent || candidate.startsWith(parent + "/");
}

export function buildResearchTagTree<T extends ResearchTaggedItem>(items: T[], tagFilter = ""): ResearchTagBranch<T>[] {
  interface Branch {
    path: string;
    label: string;
    items: Map<string, T>;
    ids: Set<string>;
    children: Map<string, Branch>;
  }
  const roots = new Map<string, Branch>();
  const untagged: T[] = [];
  for (const item of items) {
    const tags = normalizeResearchTags(item.tags).filter(tag => matchesResearchTag(tag, tagFilter));
    if (!tags.length && !tagFilter) untagged.push(item);
    for (const tag of tags) {
      let children = roots;
      let parentPath = "";
      let leaf: Branch | undefined;
      for (const label of tag.split("/")) {
        const key = label.toLocaleLowerCase();
        let branch = children.get(key);
        if (!branch) {
          branch = { path: parentPath ? `${parentPath}/${label}` : label, label, items: new Map(), ids: new Set(), children: new Map() };
          children.set(key, branch);
        }
        branch.ids.add(item.id);
        children = branch.children;
        parentPath = branch.path;
        leaf = branch;
      }
      leaf?.items.set(item.id, item);
    }
  }
  const serialize = (branches: Map<string, Branch>): ResearchTagBranch<T>[] => [...branches.values()]
    .sort((a, b) => a.label.localeCompare(b.label, "zh-CN", { numeric: true }))
    .map(branch => ({ path: branch.path, label: branch.label, count: branch.ids.size, items: [...branch.items.values()], children: serialize(branch.children) }));
  return [...serialize(roots), ...(untagged.length ? [{ path: "", label: "未分类", count: untagged.length, items: untagged, children: [] }] : [])];
}

export function getResearchTagTree(items: Pick<ResearchTaggedItem, "tags">[]) {
  const counts = new Map<string, { path: string; count: number }>();
  for (const item of items) {
    const ancestors = new Map(normalizeResearchTags(item.tags).flatMap(tag => tag.split("/").map((_part, index, parts) => {
      const path = parts.slice(0, index + 1).join("/");
      return [path.toLocaleLowerCase(), path] as const;
    })));
    for (const [key, path] of ancestors) {
      const existing = counts.get(key);
      counts.set(key, { path: existing?.path ?? path, count: (existing?.count ?? 0) + 1 });
    }
  }
  return [...counts.values()].sort((a, b) => a.path.localeCompare(b.path, "zh-CN"))
    .map(item => ({ ...item, depth: item.path.split("/").length - 1 }));
}
