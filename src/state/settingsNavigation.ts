export const settingsSections = ["general", "libraries", "storage", "backup", "history", "ai", "plugins", "about"] as const;
export type SettingsSection = (typeof settingsSections)[number];

export function readSettingsSection(url: URL): SettingsSection | null {
  if (url.searchParams.get("page") !== "settings") return null;
  const section = url.searchParams.get("section");
  return settingsSections.find(value => value === section) ?? "general";
}

export function buildSettingsUrl(current: URL, section: SettingsSection): string {
  const url = new URL(current);
  url.searchParams.set("page", "settings");
  url.searchParams.set("section", section);
  return url.href;
}

export function buildNotebookUrl(current: URL): string {
  const url = new URL(current);
  url.searchParams.set("page", "research-notebook");
  url.searchParams.delete("section");
  return url.href;
}

export interface SettingsSearchItem {
  id: string;
  section: string;
  title: string;
  description: string;
  keywords: string;
}

export function searchSettings<T extends SettingsSearchItem>(items: readonly T[], query: string): T[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(item => {
    const text = `${item.title} ${item.description} ${item.keywords}`.toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  });
}

const settingsChanged = "mewiki:settings-navigation";
let returnFocus: HTMLElement | null = null;

export function openSettings(section: SettingsSection = "general") {
  const current = new URL(location.href);
  const alreadyOpen = readSettingsSection(current) !== null;
  if (!alreadyOpen) {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    returnFocus?.blur();
  }
  const url = buildSettingsUrl(current, section);
  const state = alreadyOpen ? history.state : { ...history.state, mewikiSettingsReturn: current.href };
  if (alreadyOpen) history.replaceState(state, "", url);
  else history.pushState(state, "", url);
  window.dispatchEvent(new Event(settingsChanged));
}

export function closeSettings() {
  const current = new URL(location.href);
  const previous = history.state?.mewikiSettingsReturn;
  // A library change must never send this window back to the previous library.
  if (typeof previous === "string" && new URL(previous).searchParams.get("library") === current.searchParams.get("library")) history.back();
  else {
    history.replaceState(null, "", buildNotebookUrl(current));
    window.dispatchEvent(new Event(settingsChanged));
  }
  requestAnimationFrame(() => {
    if (returnFocus?.isConnected && returnFocus.getClientRects().length) returnFocus.focus({ preventScroll: true });
    else [...document.querySelectorAll<HTMLElement>(".research-notebook-settings, .research-note-more-toggle, input.research-note-title")]
      .find(element => element.getClientRects().length)?.focus({ preventScroll: true });
    returnFocus = null;
  });
}

export function subscribeSettingsNavigation(listener: () => void) {
  window.addEventListener(settingsChanged, listener);
  window.addEventListener("popstate", listener);
  return () => {
    window.removeEventListener(settingsChanged, listener);
    window.removeEventListener("popstate", listener);
  };
}
