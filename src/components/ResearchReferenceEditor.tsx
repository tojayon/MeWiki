import { forwardRef, useContext, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Fragment, Slice, type Node as EditorNode } from "prosemirror-model";
import { EditorState, NodeSelection, TextSelection, type Transaction } from "prosemirror-state";
import { EditorView, type NodeView } from "prosemirror-view";
import { closeHistory, history, redo, undo } from "prosemirror-history";
import { createReferenceDocument, referenceDocumentSource, referenceClipboardSource, referencePositionAt, referenceSourceOffset } from "../domain/researchReferenceEditor.ts";
import { findResearchNoteMention, insertResearchNoteMention } from "../domain/researchNoteLinks.ts";
import { findResearchSymbolMention, insertResearchSymbolMention, searchResearchSymbols } from "../domain/researchSymbolMentions.ts";
import { findResearchTermMention, insertResearchTermMention, searchResearchTerms, type TermReferenceSelection } from "../domain/researchTerms.ts";
import { getNoteLibrary } from "../domain/researchNoteLibraries.ts";
import { ResearchNoteLinkContext } from "./ResearchNoteLinkContext.ts";
import { MentionPicker, type MentionChoice, type TextMention } from "./ResearchMentionTextarea.tsx";
import type { ResearchChoiceListHandle } from "./ResearchClassifiedList.tsx";
import ResearchReferencePopover from "./ResearchReferencePopover.tsx";
import { paintReference, referencePresentation } from "./ResearchReferencePresentation.ts";
import { LibraryWorkspaceContext } from "../state/LibraryWorkspaceContext.ts";
import { t } from "../i18n/locale.ts";
import { useLocale } from "../i18n/react.ts";
import "./ResearchReferenceEditor.css";

export interface ResearchReferenceEditorHandle {
  readonly value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly element: HTMLElement;
  focus: (options?: FocusOptions) => void;
  blur: () => void;
  setSelectionRange: (start: number, end: number) => void;
  replaceRange: (text: string, start: number, end: number, caret?: number) => void;
  inspectReference: (href: string, occurrence?: number) => void;
}
interface Props {
  defaultValue: string; className?: string; style?: CSSProperties; spellCheck?: boolean; placeholder?: string;
  "aria-label": string; "aria-description"?: string; "aria-keyshortcuts"?: string;
  onBlur?: (input: ResearchReferenceEditorHandle) => void;
  onKeyDown?: (event: KeyboardEvent, input: ResearchReferenceEditorHandle) => void;
  onPaste?: (event: ClipboardEvent, source: string) => void;
}
type Inspection = { node: EditorNode; position: number; target: HTMLElement };
const clipboardType = "application/x-mewiki-references+json";

function syncDOMSelection(view: EditorView) {
  const selection = view.dom.ownerDocument.getSelection();
  if (!selection?.anchorNode || !selection.focusNode || !view.dom.contains(selection.anchorNode) || !view.dom.contains(selection.focusNode)) return;
  // Native arrow movement can precede Chromium's deferred selectionchange event.
  // Commands must use the caret the user can see, including before copy/paste.
  const anchor = view.posAtDOM(selection.anchorNode, selection.anchorOffset), head = view.posAtDOM(selection.focusNode, selection.focusOffset);
  if (anchor === view.state.selection.anchor && head === view.state.selection.head) return;
  view.dispatch(view.state.tr.setSelection(TextSelection.between(view.state.doc.resolve(anchor), view.state.doc.resolve(head))));
}

const ResearchReferenceEditor = forwardRef<ResearchReferenceEditorHandle, Props>(function ResearchReferenceEditor(props, forwardedRef) {
  const locale = useLocale(), context = useContext(ResearchNoteLinkContext), workspace = useContext(LibraryWorkspaceContext);
  const root = useRef<HTMLDivElement>(null), viewRef = useRef<EditorView | null>(null), popup = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null);
  const latest = useRef({ props, context, workspace });
  useLayoutEffect(() => { latest.current = { props, context, workspace }; });
  const composing = useRef(false), frame = useRef(0), dismissed = useRef<string | null>(null), blurFrame = useRef(0);
  const [mention, setMention] = useState<TextMention | null>(null), mentionRef = useRef<TextMention | null>(null);
  const [search, setSearch] = useState(""), [active, setActive] = useState("");
  const [inspection, setInspection] = useState<Inspection | null>(null), inspectionRef = useRef<Inspection | null>(null);
  const list = useRef<ResearchChoiceListHandle>(null), searchComposing = useRef(false), id = useId();
  const views = useRef(new Set<{ refresh: () => void }>());
  const clearMention = () => { mentionRef.current = null; setMention(null); searchComposing.current = false; };
  const setInspect = (value: Inspection | null) => { inspectionRef.current = value; setInspection(value); };
  const sessionContains = (target: EventTarget | null) => target instanceof Node && (
    root.current?.contains(target) || popup.current?.contains(target) || panel.current?.contains(target) ||
    target instanceof Element && !!target.closest('.research-selection-popup, .research-media-preview-dialog')
  );
  const finishBlur = (target: EventTarget | null) => {
    if (sessionContains(target)) return;
    clearMention(); setInspect(null); latest.current.props.onBlur?.(handle.current);
  };
  const detect = (value: string, caret: number): TextMention | null => {
    if (!latest.current.context) return null;
    let result: TextMention | null = null;
    for (const [kind, detector] of [["note", findResearchNoteMention], ["term", findResearchTermMention], ["symbol", findResearchSymbolMention]] as const) {
      const found = detector(value, caret);
      if (found && (!result || found.start > result.start)) result = { ...found, kind };
    }
    return result;
  };
  const updateMention = () => {
    const view = viewRef.current;
    if (!view || !view.hasFocus() || composing.current || inspectionRef.current || popup.current?.contains(document.activeElement)) return;
    const source = referenceDocumentSource(view.state.doc), caret = referenceSourceOffset(view.state.doc, view.state.selection.from);
    const stamp = JSON.stringify([source, caret]);
    const next = !view.state.selection.empty || dismissed.current === stamp ? null : detect(source, caret);
    const previous = mentionRef.current;
    if (next?.kind !== previous?.kind || next?.start !== previous?.start || next?.end !== previous?.end || next?.query !== previous?.query) {
      mentionRef.current = next; setMention(next); setSearch(next?.query ?? ""); setActive("");
    }
  };
  const scheduleMention = () => { cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(updateMention); };
  const cancelMention = () => {
    const view = viewRef.current;
    if (view) dismissed.current = JSON.stringify([referenceDocumentSource(view.state.doc), referenceSourceOffset(view.state.doc, view.state.selection.from)]);
    clearMention(); view?.focus();
  };
  const handle = useRef<ResearchReferenceEditorHandle>({
    get value() { return viewRef.current ? referenceDocumentSource(viewRef.current.state.doc) : ""; },
    get selectionStart() { return viewRef.current ? referenceSourceOffset(viewRef.current.state.doc, viewRef.current.state.selection.from) : 0; },
    get selectionEnd() { return viewRef.current ? referenceSourceOffset(viewRef.current.state.doc, viewRef.current.state.selection.to) : 0; },
    get element() { return viewRef.current!.dom; },
    focus: options => { if (options?.preventScroll) viewRef.current?.dom.focus(options); else viewRef.current?.focus(); },
    blur: () => viewRef.current?.dom.blur(),
    setSelectionRange: (start, end) => {
      const view = viewRef.current; if (!view) return;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, referencePositionAt(view.state.doc, start, -1), referencePositionAt(view.state.doc, end, 1))));
    },
    replaceRange: (text, start, end, caret = start + text.length) => {
      const view = viewRef.current; if (!view) return;
      const from = referencePositionAt(view.state.doc, start, -1), to = referencePositionAt(view.state.doc, end, 1);
      const content = createReferenceDocument(text).firstChild!.content;
      const transaction = closeHistory(view.state.tr).replaceWith(from, to, content);
      transaction.setSelection(TextSelection.create(transaction.doc, referencePositionAt(transaction.doc, caret)));
      view.dispatch(transaction.scrollIntoView());
    },
    inspectReference: (href, occurrence = 0) => {
      const view = viewRef.current; if (!view) return;
      let count = 0;
      view.state.doc.descendants((node, position) => {
        if (node.type.name !== "reference" || node.attrs.href !== href || count++ !== occurrence) return;
        const target = view.nodeDOM(position);
        if (target instanceof HTMLElement) setInspect({ node, position, target });
      });
    },
  });
  useImperativeHandle(forwardedRef, () => handle.current, []);
  const actions = useRef({ updateMention, finishBlur, setInspect });
  useLayoutEffect(() => { actions.current = { updateMention, finishBlur, setInspect }; });
  const mentionKeys = (event: Pick<KeyboardEvent, "key" | "keyCode" | "isComposing" | "preventDefault" | "stopPropagation" | "shiftKey" | "target">) => {
    if (!mentionRef.current || composing.current || searchComposing.current || event.isComposing || event.keyCode === 229) return false;
    if (["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (event.key === "Escape") cancelMention();
      else if (event.key === "Enter") list.current?.pick();
      else list.current?.move(event.key as "ArrowUp" | "ArrowDown");
      return true;
    }
    if (event.key === "Tab" && !event.shiftKey && event.target === viewRef.current?.dom) { event.preventDefault(); popup.current?.querySelector("input")?.focus({ preventScroll: true }); return true; }
    return false;
  };
  const keys = useRef(mentionKeys);
  useLayoutEffect(() => { keys.current = mentionKeys; });
  useLayoutEffect(() => {
    const view = new EditorView(root.current!, {
      state: EditorState.create({ doc: createReferenceDocument(latest.current.props.defaultValue), plugins: [history()] }),
      attributes: { role: "textbox", "aria-multiline": "true", "aria-label": latest.current.props["aria-label"], class: "research-reference-content" },
      nodeViews: {
        reference: (node, _view, getPos): NodeView => {
          let current = node;
          const dom = document.createElement("span"); dom.contentEditable = "false"; dom.tabIndex = -1; dom.setAttribute("role", "button"); dom.setAttribute("aria-haspopup", "dialog");
          const refresh = () => paintReference(dom, current, latest.current.context);
          const inspect = (event: Event) => {
            event.preventDefault(); event.stopPropagation();
            const position = getPos();
            if (position !== undefined) { clearMention(); actions.current.setInspect({ node: current, position, target: dom }); }
          };
          dom.addEventListener("click", inspect);
          dom.addEventListener("pointerdown", event => event.preventDefault());
          refresh(); const instance = { refresh }; views.current.add(instance);
          return { dom, update: next => { if (next.type !== current.type) return false; current = next; refresh(); return true; }, ignoreMutation: () => true,
            stopEvent: event => {
              if (event.type === "mousedown" || event.type === "pointerdown") { event.preventDefault(); return true; }
              if (event.type === "keydown" && ["Enter", " "].includes((event as KeyboardEvent).key)) {
                inspect(event);
                return true;
              }
              return false;
            }, destroy: () => { views.current.delete(instance); dom.removeEventListener("click", inspect); },
          };
        },
      },
      dispatchTransaction: transaction => {
        const current = view.state.apply(transaction); view.updateState(current);
        if (transaction.docChanged && !composing.current) {
          // A pasted or typed complete stable link becomes a node in the same history event.
          const source = referenceDocumentSource(current.doc), parsed = createReferenceDocument(source);
          if (!parsed.eq(current.doc)) {
            const from = referenceSourceOffset(current.doc, current.selection.from), to = referenceSourceOffset(current.doc, current.selection.to);
            const normalized = view.state.tr.replaceWith(0, current.doc.content.size, parsed.content);
            normalized.setSelection(TextSelection.create(normalized.doc, referencePositionAt(normalized.doc, from), referencePositionAt(normalized.doc, to)));
            view.updateState(view.state.apply(normalized));
          }
        }
        actions.current.updateMention();
      },
      handleKeyDown: (current, event) => {
        if (composing.current || event.isComposing || event.keyCode === 229) { if (["Enter", "Escape"].includes(event.key)) event.stopPropagation(); return false; }
        syncDOMSelection(current);
        if (keys.current(event)) return true;
        if (event.key === "F2" && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const selection = current.state.selection;
          const position = selection instanceof NodeSelection ? selection.from : selection.$from.nodeAfter?.type.name === "reference" ? selection.from : selection.$from.nodeBefore?.type.name === "reference" ? selection.from - 1 : null;
          const node = position === null ? null : current.state.doc.nodeAt(position), target = position === null ? null : current.nodeDOM(position);
          if (node?.type.name === "reference" && target instanceof HTMLElement) { clearMention(); actions.current.setInspect({ node, position: position!, target }); return true; }
        }
        if (!event.ctrlKey && !event.metaKey && !event.shiftKey && ["Enter", " "].includes(event.key) && current.state.selection instanceof NodeSelection) {
          const dom = current.nodeDOM(current.state.selection.from);
          if (dom instanceof HTMLElement) actions.current.setInspect({ node: current.state.selection.node, position: current.state.selection.from, target: dom });
          return true;
        }
        latest.current.props.onKeyDown?.(event, handle.current);
        if (event.defaultPrevented) return true;
        const modifier = event.ctrlKey || event.metaKey;
        if (["Home", "End"].includes(event.key) && !event.altKey) {
          const source = referenceDocumentSource(current.state.doc), caret = referenceSourceOffset(current.state.doc, current.state.selection.head);
          const lineStart = source.lastIndexOf("\n", caret - 1) + 1, nextBreak = source.indexOf("\n", caret);
          const offset = event.key === "Home" ? modifier ? 0 : lineStart : modifier ? source.length : nextBreak < 0 ? source.length : nextBreak;
          const position = referencePositionAt(current.state.doc, offset);
          current.dispatch(current.state.tr.setSelection(TextSelection.create(current.state.doc, event.shiftKey ? current.state.selection.anchor : position, position)).scrollIntoView()); return true;
        }
        if (modifier && ["z", "y"].includes(event.key.toLowerCase())) {
          event.preventDefault(); event.stopPropagation();
          (event.shiftKey || event.key.toLowerCase() === "y" ? redo : undo)(current.state, current.dispatch, current); return true;
        }
        if (modifier && event.key.toLowerCase() === "a") { current.dispatch(current.state.tr.setSelection(TextSelection.create(current.state.doc, 1, current.state.doc.content.size - 1))); return true; }
        if (event.key === "Enter") { current.dispatch(current.state.tr.insertText("\n").scrollIntoView()); return true; }
        if (["Backspace", "Delete"].includes(event.key)) {
          const { selection } = current.state;
          if (!selection.empty) { current.dispatch(closeHistory(current.state.tr).deleteSelection().scrollIntoView()); return true; }
          const backward = event.key === "Backspace", adjacent = backward ? selection.$from.nodeBefore : selection.$to.nodeAfter;
          if (adjacent?.type.name === "reference") {
            const from = backward ? selection.from - adjacent.nodeSize : selection.from;
            current.dispatch(closeHistory(current.state.tr).delete(from, from + adjacent.nodeSize).scrollIntoView()); return true;
          }
        }
        return false;
      },
      handleDOMEvents: {
        compositionstart: () => { composing.current = true; clearMention(); cancelAnimationFrame(frame.current); return false; },
        compositionend: () => { composing.current = false; scheduleMention(); return false; },
        input: () => { scheduleMention(); return false; },
        focus: () => { cancelAnimationFrame(blurFrame.current); return false; },
        blur: (_view, event) => {
          if (sessionContains(event.relatedTarget) || inspectionRef.current) return false;
          cancelAnimationFrame(blurFrame.current);
          if (event.relatedTarget) actions.current.finishBlur(event.relatedTarget);
          else blurFrame.current = requestAnimationFrame(() => actions.current.finishBlur(document.activeElement));
          return false;
        },
        copy: (current, event) => writeClipboard(current, event, false),
        cut: (current, event) => writeClipboard(current, event, true),
      },
      handlePaste: (current, event) => {
        syncDOMSelection(current);
        let source = event.clipboardData?.getData("text/plain") ?? "";
        const internal = event.clipboardData?.getData(clipboardType);
        if (internal) try {
          const data = JSON.parse(internal);
          if (data.library === latest.current.workspace?.profile.id && typeof data.source === "string") source = data.source;
        } catch { /* A foreign clipboard falls back to readable plain text. */ }
        latest.current.props.onPaste?.(event, source); if (event.defaultPrevented) return true;
        event.preventDefault();
        // Unsupported/empty clipboard content must never replace the user's current selection.
        if (!source) return true;
        current.dispatch(closeHistory(current.state.tr).replaceSelection(new Slice(createReferenceDocument(source).firstChild!.content, 0, 0)).scrollIntoView()); return true;
      },
    });
    viewRef.current = view;
    // Mount replay can recreate node views after a parent has requested inspection.
    const pendingInspection = inspectionRef.current;
    if (pendingInspection) {
      const target = view.nodeDOM(pendingInspection.position);
      if (target instanceof HTMLElement) actions.current.setInspect({ ...pendingInspection, target });
    }
    function writeClipboard(current: EditorView, event: ClipboardEvent, cut: boolean) {
      syncDOMSelection(current);
      if (!event.clipboardData || current.state.selection.empty) return false;
      const fragment = current.state.selection.content().content;
      const readable = (content: Fragment): string => {
        let result = "";
        content.forEach((node, _offset, index) => {
          if (index > 0 && node.isBlock) result += "\n";
          result += node.type.name === "reference" ? referencePresentation(node, latest.current.context).text : node.isText ? node.text : node.type.name === "hard_break" ? "\n" : readable(node.content);
        }); return result;
      };
      event.preventDefault();
      event.clipboardData.setData("text/plain", readable(fragment));
      event.clipboardData.setData(clipboardType, JSON.stringify({ library: latest.current.workspace?.profile.id, source: referenceClipboardSource(fragment) }));
      if (cut) current.dispatch(closeHistory(current.state.tr).deleteSelection());
      return true;
    }
    return () => { cancelAnimationFrame(frame.current); cancelAnimationFrame(blurFrame.current); view.destroy(); viewRef.current = null; };
  }, []);
  useLayoutEffect(() => {
    const view = viewRef.current; if (!view) return;
    view.dom.setAttribute("aria-label", props["aria-label"]);
    for (const attribute of ["aria-description", "aria-keyshortcuts"] as const) if (props[attribute]) view.dom.setAttribute(attribute, props[attribute]);
    view.dom.setAttribute("spellcheck", String(props.spellCheck ?? true));
    view.dom.setAttribute("data-placeholder", props.placeholder ?? "");
    view.dom.setAttribute("aria-expanded", String(!!mention));
    view.dom.setAttribute("aria-autocomplete", "list");
    if (mention && active) view.dom.setAttribute("aria-activedescendant", active); else view.dom.removeAttribute("aria-activedescendant");
    if (mention) view.dom.setAttribute("aria-controls", `${id}-list`); else view.dom.removeAttribute("aria-controls");
  }, [props, mention, active, id]);
  useLayoutEffect(() => { views.current.forEach(instance => instance.refresh()); }, [context, locale]);

  const tokens = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const choices: MentionChoice[] = !mention ? [] : mention.kind === "symbol" ? searchResearchSymbols(context?.symbols ?? [], search).map(symbol => ({ kind: "symbol", symbol }))
    : mention.kind === "term" ? searchResearchTerms(context?.terms ?? [], search).map(term => ({ kind: "term", term }))
    : (context?.notes ?? []).filter(note => note.id !== context?.sourceNoteId && tokens.every(token => [note.title, ...(note.tags ?? []), getNoteLibrary(note) === "foundation" ? t("基础理论") : t("研究记录")].join(" ").toLocaleLowerCase().includes(token))).map(note => ({ kind: "note", note }));
  const pick = (choice: MentionChoice, selection?: TermReferenceSelection) => {
    const current = mentionRef.current; if (!current) return;
    const value = handle.current.value, found = detect(value, handle.current.selectionStart);
    if (!found || found.start !== current.start || found.end !== current.end || found.kind !== current.kind) { cancelMention(); return; }
    const result = choice.kind === "note" ? { ...insertResearchNoteMention(value, current, choice.note), end: current.end } : choice.kind === "term" ? { ...insertResearchTermMention(value, current, choice.term, selection), end: current.end } : insertResearchSymbolMention(value, current, choice.symbol);
    clearMention(); dismissed.current = JSON.stringify([result.text, result.caret]);
    handle.current.replaceRange(result.text.slice(current.start, result.caret), current.start, result.end); viewRef.current?.focus();
  };
  const closeInspection = (restore = false) => {
    setInspect(null);
    if (restore) viewRef.current?.focus();
    else if (!viewRef.current?.hasFocus()) latest.current.props.onBlur?.(handle.current);
  };
  const changeReference = (source: string) => {
    const current = inspectionRef.current, view = viewRef.current;
    if (!current || !view || !view.state.doc.nodeAt(current.position)?.eq(current.node)) { closeInspection(true); return; }
    const transaction: Transaction = closeHistory(view.state.tr).replaceWith(current.position, current.position + current.node.nodeSize, createReferenceDocument(source).firstChild!.content);
    transaction.setSelection(TextSelection.create(transaction.doc, current.position + createReferenceDocument(source).firstChild!.content.size));
    view.dispatch(transaction); closeInspection(true);
  };
  return <><div ref={root} className={["research-reference-editor", props.className].filter(Boolean).join(" ")} style={props.style} />
    {mention && <MentionPicker key={id + mention.kind} id={id} popupRef={popup} getAnchor={() => viewRef.current!.coordsAtPos(viewRef.current!.state.selection.from)} kind={mention.kind} choices={choices} total={choices.length} active={active} listRef={list} onActiveChange={setActive} query={search}
      onQuery={query => { setSearch(query); setActive(""); }} onPick={pick} onCancel={cancelMention}
      onKeyDown={event => { mentionKeys(event.nativeEvent); }} onComposition={value => { searchComposing.current = value; }}
      onSessionBlur={event => { if (!sessionContains(event.relatedTarget)) finishBlur(event.relatedTarget); }} />}
    {inspection && createPortal(<div ref={panel} onBlur={event => {
      if (!event.relatedTarget) return;
      if (!sessionContains(event.relatedTarget)) finishBlur(event.relatedTarget);
    }}><ResearchReferencePopover node={inspection.node} target={inspection.target} onApply={changeReference} onDelete={() => changeReference("")} onCancel={closeInspection} /></div>, inspection.target.closest("dialog") ?? document.body)}
  </>;
});
export default ResearchReferenceEditor;
