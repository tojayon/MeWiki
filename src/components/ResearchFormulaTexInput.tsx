import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { formulaTexDiagnostic, previewFormulaTex, type FormulaTexDiagnostic } from "../domain/formulaTexPreview.ts";
import { parseFormulaText, type FormulaClipboardParseResult } from "../domain/formulaTransfer.ts";
import type { ResearchSymbolEntry } from "../domain/researchDictionary.ts";
import "./ResearchFormulaTexInput.css";

export function ResearchFormulaTexInput({ id, symbols, onInsert, onCancel }: {
  id: string;
  symbols: ResearchSymbolEntry[];
  onInsert: (parsed: FormulaClipboardParseResult) => string | null;
  onCancel: () => void;
}) {
  const [source, setSource] = useState("");
  const [insertError, setInsertError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const inputId = useId(), errorId = useId();
  const preview = useMemo(() => previewFormulaTex(source), [source]);
  const parsed = useMemo(() => preview.html ? parseFormulaText(source, symbols) : undefined, [source, symbols, preview]);
  const diagnostic: FormulaTexDiagnostic | undefined = preview.diagnostic ?? (parsed?.error
    ? formulaTexDiagnostic(source, parsed.error, parsed.errorRange?.start ?? preview.sourceOffset, parsed.errorRange?.end ?? preview.sourceOffset + preview.tex.length) : undefined);
  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, []);
  const insert = () => {
    if (diagnostic || !parsed?.parts?.length) return;
    setInsertError(onInsert(parsed));
  };
  const locateError = () => {
    if (!diagnostic || !ref.current) return;
    const textarea = ref.current;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(diagnostic.start, diagnostic.end);
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 21;
    textarea.scrollTop = Math.max(0, (diagnostic.line - 1) * lineHeight - textarea.clientHeight / 2);
  };
  const excerptStart = diagnostic ? Math.max(source.lastIndexOf("\n", diagnostic.start - 1) + 1, diagnostic.start - 65) : 0;
  const excerptEnd = diagnostic ? Math.min(source.indexOf("\n", diagnostic.start) < 0 ? source.length : source.indexOf("\n", diagnostic.start), diagnostic.end + 80) : 0;
  return (
    <section id={id} className="research-formula-tex-input" role="region" aria-label="LaTeX 公式输入">
      <div className="research-formula-tex-input-heading">
        <label htmlFor={inputId}>LaTeX</label>
        <button type="button" data-ui="icon-action" aria-label="关闭 LaTeX 输入" title="关闭 · Esc" onClick={onCancel}><X size={15} /></button>
      </div>
      <div className="research-formula-tex-input-grid">
        <textarea id={inputId} ref={ref} aria-label="LaTeX 公式" rows={5} spellCheck={false} autoComplete="off" autoCapitalize="off" dir="ltr"
          value={source} placeholder={"粘贴 LaTeX，例如 \\frac{p+1}{2}"} aria-invalid={diagnostic ? "true" : undefined} aria-describedby={diagnostic || insertError ? errorId : undefined}
          onChange={event => { setSource(event.target.value); setInsertError(null); }}
          onKeyDown={event => {
            event.stopPropagation();
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") { event.preventDefault(); onCancel(); }
            else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); insert(); }
          }} />
        <div className="research-formula-tex-live-preview" role="region" aria-label="LaTeX 实时预览" aria-live="polite" aria-atomic="true">
          {preview.html ? <span className="formula" dangerouslySetInnerHTML={{ __html: preview.html }} />
            : <span className="research-formula-tex-preview-placeholder">{preview.diagnostic ? "修正错误后显示预览" : "粘贴后实时预览"}</span>}
        </div>
      </div>
      {(diagnostic || insertError) && <div id={errorId} className="research-formula-tex-diagnostic" role="alert">
        {diagnostic && <>
          <button type="button" title="点击定位输入中的错误" onClick={locateError}>第 {diagnostic.line} 行，第 {diagnostic.column} 列 · {diagnostic.message}</button>
          <pre aria-hidden="true">{source.slice(excerptStart, diagnostic.start)}<mark>{diagnostic.start === diagnostic.end ? "▏" : source.slice(diagnostic.start, Math.min(diagnostic.end, excerptEnd))}</mark>{source.slice(Math.max(diagnostic.start, diagnostic.end), excerptEnd)}</pre>
        </>}
        {insertError && <p>{insertError}</p>}
      </div>}
      <div className="research-formula-tex-input-actions">
        <button type="button" title="插入到所选位置 · Ctrl/Cmd+Enter" disabled={!!diagnostic || !parsed?.parts?.length} onClick={insert}>插入公式</button>
      </div>
    </section>
  );
}
