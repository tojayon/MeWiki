import { useSyncExternalStore } from "react";
import { readSettingsSection, subscribeSettingsNavigation } from "./settingsNavigation.ts";

export function useSettingsNavigation() {
  return useSyncExternalStore(subscribeSettingsNavigation, () => readSettingsSection(new URL(location.href)));
}
