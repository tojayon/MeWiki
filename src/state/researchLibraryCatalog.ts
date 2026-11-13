export interface LibraryProfile {
  id: string;
  name: string;
  directory: string | null;
}
export interface LibraryCatalog {
  libraries: LibraryProfile[];
  contextDefaults: Record<string, string>;
}
export interface LibraryEntryChoice {
  id: string;
  name: string;
}

export function libraryEntryChoices(options: {
  plugins: readonly { id: string; workspace?: { name: string } }[];
  connection: { id: string; name: string } | null;
  contextDefaults: Readonly<Record<string, string>>;
  context: string;
}): LibraryEntryChoice[] {
  const entries = new Map<string, LibraryEntryChoice>();
  const add = (id: string, name = id) => {
    if (!id || id === "standalone" || entries.has(id)) return;
    entries.set(id, { id, name: name.trim() || id });
  };
  for (const plugin of options.plugins) {
    if (plugin.workspace) add(plugin.id, plugin.workspace.name);
  }
  if (options.connection) add(options.connection.id, options.connection.name);
  for (const id of Object.keys(options.contextDefaults)) add(id);
  add(options.context);
  return [...entries.values()];
}
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
  return "default";
}
