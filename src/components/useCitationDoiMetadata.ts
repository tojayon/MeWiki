import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { normalizeCitationDoi, type ResearchCitationBlock } from "../domain/researchCitation.ts";
import { researchMediaClient } from "../state/researchMediaClient.ts";

const fields = ["title", "authors", "year", "venue", "url"] as const;
const context = (block: ResearchCitationBlock, canEdit: boolean, directory: string | null) => JSON.stringify([block.id, block.doi, canEdit, directory]);
function validDoi(value: string): string | undefined {
  try { return normalizeCitationDoi(value); } catch { return; }
}

export function useCitationDoiMetadata({ block, canEdit, directory, onPatch }: {
  block: ResearchCitationBlock; canEdit: boolean; directory: string | null;
  onPatch: (patch: Partial<ResearchCitationBlock>) => void;
}) {
  const inputKey = JSON.stringify([block.id, block.doi]);
  const [draft, setDraft] = useState({ key: inputKey, value: block.doi ?? "" });
  const doi = draft.key === inputKey ? draft.value : block.doi ?? "";
  const key = context(block, canEdit, directory);
  const [request, setRequest] = useState<{ id: number; key: string; doi: string }>();
  const [result, setResult] = useState<{ id: number; error?: string; status?: string }>();
  const [inputError, setInputError] = useState("");
  const lifecycleKey = JSON.stringify([block.id, canEdit, directory]);
  const [observedLifecycle, setObservedLifecycle] = useState(lifecycleKey);
  if (observedLifecycle !== lifecycleKey) {
    setObservedLifecycle(lifecycleKey); setRequest(undefined);
  }
  const sequence = useRef(0), lastAttempt = useRef<string>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined), abort = useRef<AbortController>(undefined);
  const edits = useRef({ title: 0, authors: 0, year: 0, venue: 0, url: 0 });
  const urlDraftEdited = useRef(false);
  const latest = useRef({ block, canEdit, directory, onPatch, doi, key });
  useLayoutEffect(() => { latest.current = { block, canEdit, directory, onPatch, doi, key }; }, [block, canEdit, directory, onPatch, doi, key]);
  useLayoutEffect(() => () => {
    sequence.current++; lastAttempt.current = undefined;
    clearTimeout(timer.current); abort.current?.abort();
  }, [block.id, canEdit, directory]);

  const patch = (value: Partial<ResearchCitationBlock>) => {
    if (!latest.current.canEdit) return;
    for (const field of fields) if (field in value) edits.current[field]++;
    if ("url" in value) urlDraftEdited.current = false;
    latest.current.onPatch(value);
  };
  const commit = (force = false) => {
    clearTimeout(timer.current);
    const current = latest.current;
    if (!current.canEdit) return;
    let normalized: string | undefined;
    try { normalized = current.doi.trim() ? normalizeCitationDoi(current.doi) : undefined; }
    catch (cause) { setInputError(cause instanceof Error ? cause.message : "DOI 无效。"); return; }
    // Preserve a stored DOI's spelling when only its prefix or case was edited.
    if (normalized?.toLowerCase() === current.block.doi?.toLowerCase()) normalized = current.block.doi;
    const nextKey = context({ ...current.block, doi: normalized }, current.canEdit, current.directory);
    current.doi = normalized ?? "";
    setDraft({ key: JSON.stringify([current.block.id, normalized]), value: normalized ?? "" });
    if (normalized !== current.block.doi) current.onPatch({ doi: normalized });
    setInputError("");
    if (!normalized || !force && lastAttempt.current === nextKey) return;
    abort.current?.abort();
    lastAttempt.current = nextKey;
    setRequest({ id: ++sequence.current, key: nextKey, doi: normalized });
  };
  const changeDoi = (value: string) => {
    if (!latest.current.canEdit) return;
    clearTimeout(timer.current); abort.current?.abort(); sequence.current++;
    lastAttempt.current = undefined; setRequest(undefined); setInputError("");
    latest.current.doi = value;
    setDraft({ key: JSON.stringify([latest.current.block.id, latest.current.block.doi]), value });
    if (validDoi(value)) timer.current = setTimeout(() => commit(), 700);
  };

  useEffect(() => {
    if (!request || request.key !== key || request.id !== sequence.current) return;
    const controller = new AbortController(); abort.current = controller;
    const original = latest.current.block, versions = { ...edits.current };
    const current = () => !controller.signal.aborted && sequence.current === request.id && latest.current.canEdit && latest.current.key === request.key && validDoi(latest.current.doi)?.toLowerCase() === request.doi.toLowerCase();
    void (async () => {
      try {
        const metadata = await researchMediaClient.citationMetadata(request.doi, controller.signal);
        if (!current()) return;
        if (validDoi(metadata.doi)?.toLowerCase() !== request.doi.toLowerCase()) throw new Error("返回的文献 DOI 不一致，原有资料已保留。");
        const values: Partial<ResearchCitationBlock> = {};
        for (const field of fields) {
          if (!(field === "url" && urlDraftEdited.current) && !original[field]?.trim() && latest.current.block[field] === original[field] && edits.current[field] === versions[field] && metadata[field]) values[field] = metadata[field];
        }
        if (Object.keys(values).length) latest.current.onPatch(values);
        setResult({ id: request.id, status: "已获取文献元信息" });
      } catch (cause) {
        if (current()) setResult({ id: request.id, error: cause instanceof Error ? cause.message : "暂时无法获取 DOI 元信息，可手动填写。" });
      }
    })();
    return () => { controller.abort(); if (abort.current === controller) abort.current = undefined; };
  }, [request, key]);

  const visible = request?.key === key && result?.id === request?.id ? result : undefined;
  return { doi, changeDoi, saveDoi: () => commit(), fetchMetadata: () => commit(true), patch,
    editUrlDraft: () => { edits.current.url++; urlDraftEdited.current = true; },
    loading: !!request && request.key === key && result?.id !== request.id,
    error: inputError || visible?.error, status: visible?.status,
  };
}
