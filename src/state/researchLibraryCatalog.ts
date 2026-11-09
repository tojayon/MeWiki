export interface LibraryProfile {
  id: string;
  name: string;
  directory: string | null;
}
export interface LibraryCatalog {
  libraries: LibraryProfile[];
  contextDefaults: Record<string, string>;
}
export const WEBBENCH_WORKSPACE = "org.mewiki.webbench";
export function libraryCacheKey(id: string) {
  return id === "default"
    ? "mewiki:research-notebook"
    : `mewiki:library:${id}:notebook`;
}
export function selectLibrary(
  catalog: LibraryCatalog,
  options: {
    context: string;
    explicit?: string | null;
    remembered?: string | null;
  },
): string {
  const exists = (id?: string | null) =>
    !!id && catalog.libraries.some((item) => item.id === id);
  if (options.explicit) {
    if (!exists(options.explicit))
      throw new Error("指定的资料库不存在或已从列表移除，请重新选择。");
    return options.explicit;
  }
  if (exists(options.remembered)) return options.remembered!;
  const preferred = catalog.contextDefaults[options.context];
  if (exists(preferred)) return preferred;
  if (options.context === WEBBENCH_WORKSPACE) {
    const cislunar = catalog.libraries.find(
      (item) => item.name.toLowerCase() === "cislunar",
    );
    if (cislunar) return cislunar.id;
  }
  return "default";
}
