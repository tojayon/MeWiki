const memory = new Map<string, string | null>();
const unsaved = new Set<string>();
const fontIdPattern = /^[a-f0-9]{64}$/;
export const INTERFACE_FONT_CHANGED_EVENT = 'mewiki:interface-font-changed';
export const interfaceFontPreferenceKey = (libraryId: string) => `mewiki:library:${encodeURIComponent(libraryId)}:interface-font`;

export function readInterfaceFontPreference(libraryId: string, storage?: Pick<Storage, 'getItem'>): string | null {
  if (unsaved.has(libraryId)) return memory.get(libraryId) ?? null;
  try {
    if (storage) {
      const value = storage.getItem(interfaceFontPreferenceKey(libraryId));
      const id = value && fontIdPattern.test(value) ? value : null;
      memory.set(libraryId, id);
      return id;
    }
  } catch { /* Retain a previously chosen font for this window session. */ }
  return memory.get(libraryId) ?? null;
}

export function saveInterfaceFontPreference(libraryId: string, fontId: string | null, storage?: Pick<Storage, 'setItem'>): void {
  if (fontId !== null && !fontIdPattern.test(fontId)) throw new Error('所选字体标识无效，请重新选择字体。');
  memory.set(libraryId, fontId);
  try {
    if (!storage) throw new Error('storage unavailable');
    storage.setItem(interfaceFontPreferenceKey(libraryId), fontId ?? '');
    unsaved.delete(libraryId);
  } catch { unsaved.add(libraryId); }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(INTERFACE_FONT_CHANGED_EVENT, { detail: { libraryId } }));
}
