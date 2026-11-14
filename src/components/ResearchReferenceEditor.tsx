import { forwardRef, useCallback, useContext, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { Fragment, Slice, type Node as EditorNode } from "prosemirror-model";
import { EditorState, NodeSelection, TextSelection, type Transaction } from "prosemirror-state";
import { EditorView, type NodeView } from "prosemirror-view";
import { closeHistory, history, redo, undo } from "prosemirror-history";
import { baseKeymap, toggleMark, setBlockType } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { splitListItem } from "prosemirror-schema-list";
import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule, undoInputRule } from "prosemirror-inputrules";
import katex from "katex";
import { Code2, Pilcrow } from "lucide-react";
import { createReferenceDocument, referenceDocumentSource, referenceClipboardSource, referencePositionAt, referenceSourceOffset, referenceEditorSchema } from "../domain/researchReferenceEditor.ts";
import { findResearchNoteMention, insertResearchNoteMention } from "../domain/researchNoteLinks.ts";
import { findResearchSymbolMention, insertResearchSymbolMention, searchResearchSymbols } from "../domain/researchSymbolMentions.ts";
import { findResearchTermMention, insertResearchTermMention, searchResearchTerms, type TermReferenceSelection } from "../domain/researchTerms.ts";
import { getNoteLibrary } from "../domain/researchNoteLibraries.ts";
import { ResearchNoteLinkContext } from "./ResearchNoteLinkContext.ts";
import { MentionPicker, type MentionChoice, type TextMention } from "./ResearchMentionTextarea.tsx";
import type { ResearchChoiceListHandle } from "./ResearchClassifiedList.tsx";
import ResearchReferencePopover from "./ResearchReferencePopover.tsx";
import ResearchTermPopover from "./ResearchTermPopover.tsx";
import { FormulaSymbolPopover } from "./ResearchFormulaRelations.tsx";
import ResearchMarkdown from "./ResearchMarkdown.tsx";
import ResearchInlineFormula from "./ResearchInlineFormula.tsx";
import { dictionaryReferenceBindings, dictionaryReferenceId } from "../domain/researchTerms.ts";
import type { ResearchOutlineHeading } from "../domain/researchOutline.ts";
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
  setSelectionAtPoint: (x: number, y: number, extend?: boolean) => void;
  replaceRange: (text: string, start: number, end: number, caret?: number) => void;
  inspectReference: (href: string, occurrence?: number) => void;
}
interface Props {
  defaultValue: string; className?: string; style?: CSSProperties; spellCheck?: boolean; placeholder?: string;
  "aria-label": string; "aria-description"?: string; "aria-keyshortcuts"?: string;
  onBlur?: (input: ResearchReferenceEditorHandle) => void;
  onKeyDown?: (event: KeyboardEvent, input: ResearchReferenceEditorHandle) => void;
  onPaste?: (event: ClipboardEvent, source: string) => void;
  headings?: readonly ResearchOutlineHeading[];
}
type Inspection = { node: EditorNode; position: number; target: HTMLElement; detail?: boolean };
const clipboardType = "application/x-mewiki-references+json";

function insertionSlice(source: string) {
  const doc = createReferenceDocument(source);
  return doc.childCount === 1 && doc.firstChild!.type.name === "paragraph" ? new Slice(doc.firstChild!.content, 0, 0) : Slice.maxOpen(doc.content);
}

function markdownInputRules() {
  const schema = referenceEditorSchema;
  const mark = (pattern: RegExp, name: string, delimiter: number) => new InputRule(pattern, (state, match, start, end) => {
    if (name === "code" && match[1].includes("\ufffc")) return null;
    const type = schema.marks[name], style = type.create(name === "strong" || name === "em" ? { delimiter: match[0].slice(0, delimiter) } : null);
    // Delete only the typed punctuation. The middle can contain atoms and nested marks.
    return state.tr.delete(end - (delimiter - 1), end).delete(start, start + delimiter)
      .addMark(start, start + match[1].length, style).removeStoredMark(type);
  }, { inCodeMark: false });
  return inputRules({ rules: [
    textblockTypeInputRule(/^(#{1,6})\s$/, schema.nodes.heading, match => ({ level: match[1].length })),
    wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote),
    wrappingInputRule(/^\s*[-+*]\s$/, schema.nodes.bullet_list),
    wrappingInputRule(/^(\d+)\.\s$/, schema.nodes.ordered_list, match => ({ order: Number(match[1]) })),
    mark(/\*\*([^*\n]+)\*\*$/, "strong", 2), mark(/__([^_\n]+)__$/, "strong", 2),
    mark(/(?<!\*)\*([^*\n]+)\*$/, "em", 1), mark(/~~([^~\n]+)~~$/, "strike", 2), mark(/`([^`\n]+)`$/, "code", 1),
    new InputRule(/\[[^\]\n]+\]\([^\s)]+\)$/, (state, match, start, end) => {
      const parsed = createReferenceDocument(match[0]);
      if (!parsed.firstChild?.firstChild || parsed.firstChild.firstChild.type.name !== "reference") return null;
      return state.tr.replaceWith(start, end, parsed.firstChild.content);
    }),
    new InputRule(/(?<!\$)\$([^$\n]+)\$$/, (state, match, start, end) => {
      const node = createReferenceDocument(match[0]).firstChild?.firstChild;
      return node?.type.name === "inline_math" ? state.tr.replaceWith(start, end, node.mark(state.selection.$from.marks())) : null;
    }, { inCodeMark: false }),
  ] });
}

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
  const viewToggle = useRef<HTMLButtonElement>(null);
  const [toolsHost, setToolsHost] = useState<HTMLElement | null>(null);
  const attachRoot = useCallback((element: HTMLDivElement | null) => {
    root.current = element;
    setToolsHost(element?.classList.contains("research-text-source") ? element.closest<HTMLElement>(".research-note-block") : null);
  }, []);
  const mount = useRef<HTMLDivElement>(null), sourceInput = useRef<HTMLTextAreaElement>(null), sourceModeRef = useRef(false);
  const [sourceValue, setSourceValue] = useState<string | null>(null);
  const replay = useRef<{ state: EditorState; focused: boolean } | null>(null);
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
    root.current?.contains(target) || viewToggle.current?.contains(target) || popup.current?.contains(target) || panel.current?.contains(target) ||
    target instanceof Element && !!target.closest('.research-selection-popup, .research-media-preview-dialog')
  );
  const finishBlur = (target: EventTarget | null) => {
    if (sessionContains(target)) return;
    clearMention(); setInspect(null); latest.current.props.onBlur?.(handle.current);
  };
  const detect = (value: string, caret: number): TextMention | null => {
    if (!latest.current.context) return null;
    const view = viewRef.current, selection = view?.state.selection, parent = selection?.$from.parent;
    if (parent?.type.spec.code || selection?.$from.marks().some(mark => mark.type.name === "code")) return null;
    const visible = parent && selection ? parent.textBetween(0, selection.$from.parentOffset, "\n", "\ufffc") : value.slice(0, caret);
    let result: TextMention | null = null;
    for (const [kind, detector] of [["note", findResearchNoteMention], ["term", findResearchTermMention], ["symbol", findResearchSymbolMention]] as const) {
      const found = detector(visible, visible.length);
      if (found && (!result || found.start > result.start)) result = { ...found, kind };
    }
    if (result && view && selection) result = { ...result,
      start: referenceSourceOffset(view.state.doc, selection.$from.start() + result.start),
      end: referenceSourceOffset(view.state.doc, selection.from),
    };
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
    get value() { return sourceModeRef.current ? sourceInput.current?.value ?? "" : viewRef.current ? referenceDocumentSource(viewRef.current.state.doc) : ""; },
    get selectionStart() { return sourceModeRef.current ? sourceInput.current?.selectionStart ?? 0 : viewRef.current ? referenceSourceOffset(viewRef.current.state.doc, viewRef.current.state.selection.from) : 0; },
    get selectionEnd() { return sourceModeRef.current ? sourceInput.current?.selectionEnd ?? 0 : viewRef.current ? referenceSourceOffset(viewRef.current.state.doc, viewRef.current.state.selection.to) : 0; },
    get element() { return sourceModeRef.current ? sourceInput.current! : viewRef.current!.dom; },
    focus: options => { if (sourceModeRef.current) sourceInput.current?.focus(options); else if (options?.preventScroll) viewRef.current?.dom.focus(options); else viewRef.current?.focus(); },
    blur: () => { if (sourceModeRef.current) sourceInput.current?.blur(); else viewRef.current?.dom.blur(); },
    setSelectionRange: (start, end) => {
      if (sourceModeRef.current) { sourceInput.current?.setSelectionRange(start, end); return; }
      const view = viewRef.current; if (!view) return;
      view.dispatch(view.state.tr.setSelection(TextSelection.between(view.state.doc.resolve(referencePositionAt(view.state.doc, start, -1)), view.state.doc.resolve(referencePositionAt(view.state.doc, end, 1)))));
    },
    setSelectionAtPoint: (x, y, extend = false) => {
      const view = viewRef.current, found = view?.posAtCoords({ left: x, top: y }); if (!view || !found) return;
      const position = view.state.doc.resolve(found.pos);
      view.dispatch(view.state.tr.setSelection(TextSelection.between(extend ? view.state.selection.$anchor : position, position)));
    },
    replaceRange: (text, start, end, caret = start + text.length) => {
      const view = viewRef.current; if (!view) return;
      const from = referencePositionAt(view.state.doc, start, -1), to = referencePositionAt(view.state.doc, end, 1);
      let content = insertionSlice(text);
      const marks = view.state.storedMarks ?? view.state.doc.resolve(from).marks();
      if (content.openStart === 0 && content.openEnd === 0 && content.content.firstChild?.isInline) {
        const children: EditorNode[] = []; content.content.forEach(node => children.push(node.mark([...marks, ...node.marks.filter(mark => !marks.some(existing => existing.type === mark.type))])));
        content = new Slice(Fragment.from(children), 0, 0);
      }
      const transaction = closeHistory(view.state.tr).replaceRange(from, to, content);
      transaction.setSelection(TextSelection.near(transaction.doc.resolve(referencePositionAt(transaction.doc, caret))));
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
    const view = new EditorView(mount.current!, {
      state: replay.current?.state ?? EditorState.create({ doc: createReferenceDocument(latest.current.props.defaultValue), plugins: [history(), markdownInputRules(), keymap(baseKeymap)] }),
      attributes: { role: "textbox", "aria-multiline": "true", "aria-label": latest.current.props["aria-label"], class: "research-reference-content" },
      nodeViews: {
        paragraph: () => {
          const dom = document.createElement("p"); dom.className = "research-reference-line"; dom.dataset.placeholder = latest.current.props.placeholder ?? "";
          return { dom, contentDOM: dom };
        },
        heading: (node, currentView, getPos): NodeView => {
          const dom = document.createElement(`h${node.attrs.level}`), contentDOM = document.createElement("span");
          let index = 0; const position = getPos();
          currentView.state.doc.descendants((child, at) => { if (child.type.name === "heading" && position !== undefined && at < position) index++; });
          const heading = latest.current.props.headings?.[index];
          if (heading) {
            dom.id = `research-heading-${heading.id}`; dom.dataset.outlineId = heading.id;
            const number = document.createElement("span"); number.className = "research-heading-number"; number.contentEditable = "false"; number.textContent = heading.number + " "; dom.append(number);
          }
          dom.append(contentDOM); return { dom, contentDOM };
        },
        list_item: node => {
          const dom = document.createElement("li"), contentDOM = document.createElement("div"); contentDOM.className = "research-list-item-content";
          if (node.attrs.checked !== null) {
            dom.className = "task-list-item"; dom.dataset.checked = String(node.attrs.checked);
            const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = node.attrs.checked; checkbox.disabled = true; checkbox.contentEditable = "false"; dom.append(checkbox);
          }
          dom.append(contentDOM); return { dom, contentDOM };
        },
        inline_math: node => {
          const dom = document.createElement("span"); dom.contentEditable = "false"; dom.dataset.mathSource = node.attrs.source;
          // Coordinate selection runs before the React root commits. Paint the same
          // formula now so line wrapping and the browser's scroll anchor stay put.
          const initial = document.createElement("span"), formula = document.createElement("span");
          initial.className = "research-inline-formula"; formula.className = "formula";
          formula.innerHTML = katex.renderToString(node.attrs.tex, { throwOnError: false, output: "htmlAndMathml" });
          initial.append(formula); dom.append(initial);
          const renderer = createRoot(dom);
          renderer.render(<ResearchNoteLinkContext.Provider value={latest.current.context}><ResearchInlineFormula tex={node.attrs.tex} /></ResearchNoteLinkContext.Provider>);
          return { dom, ignoreMutation: () => true, stopEvent: event => event.target instanceof Element && !!event.target.closest("button"), destroy: () => { queueMicrotask(() => renderer.unmount()); } };
        },
        math_block: node => {
          const dom = document.createElement("div"); dom.contentEditable = "false"; dom.dataset.mathSource = node.attrs.source;
          dom.innerHTML = katex.renderToString(node.attrs.tex, { displayMode: true, throwOnError: false, strict: "ignore", trust: false });
          return { dom, ignoreMutation: () => true };
        },
        raw_block: node => {
          const dom = document.createElement("div"); dom.contentEditable = "false"; dom.dataset.markdownSource = node.attrs.source;
          if (node.attrs.hidden) { dom.hidden = true; return { dom, ignoreMutation: () => true }; }
          const renderer = createRoot(dom); renderer.render(<ResearchNoteLinkContext.Provider value={latest.current.context}><LibraryWorkspaceContext.Provider value={latest.current.workspace}><ResearchMarkdown text={node.attrs.source} /></LibraryWorkspaceContext.Provider></ResearchNoteLinkContext.Provider>);
          return { dom, ignoreMutation: () => true, destroy: () => { queueMicrotask(() => renderer.unmount()); } };
        },
        image: node => {
          const dom = document.createElement("span"); dom.contentEditable = "false"; dom.dataset.markdownSource = node.attrs.source;
          const renderer = createRoot(dom); renderer.render(<LibraryWorkspaceContext.Provider value={latest.current.workspace}><ResearchMarkdown text={node.attrs.source} inline /></LibraryWorkspaceContext.Provider>);
          return { dom, ignoreMutation: () => true, destroy: () => { queueMicrotask(() => renderer.unmount()); } };
        },
        reference: (node, _view, getPos): NodeView => {
          let current = node;
          const dom = document.createElement("span"); dom.contentEditable = "false"; dom.tabIndex = 0; dom.setAttribute("role", "button"); dom.setAttribute("aria-haspopup", "dialog");
          const refresh = () => paintReference(dom, current, latest.current.context);
          const inspect = (event: Event, detail = true) => {
            event.preventDefault(); event.stopPropagation();
            const position = getPos();
            if (position !== undefined) { clearMention(); actions.current.setInspect({ node: current, position, target: dom, detail: detail && !referencePresentation(current, latest.current.context).missing && ["term", "symbol"].includes(current.attrs.kind) }); }
          };
          const click = (event: Event) => inspect(event);
          const keydown = (event: KeyboardEvent) => {
            if (event.key === "F2") inspect(event, false);
            else if (["Enter", " "].includes(event.key)) inspect(event);
          };
          dom.addEventListener("click", click);
          dom.addEventListener("keydown", keydown);
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
            }, destroy: () => { views.current.delete(instance); dom.removeEventListener("click", click); dom.removeEventListener("keydown", keydown); },
          };
        },
      },
      dispatchTransaction: transaction => {
        const current = view.state.apply(transaction); view.updateState(current);
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
        if (!event.ctrlKey && !event.metaKey && !event.shiftKey && ["Enter", " "].includes(event.key) && current.state.selection instanceof NodeSelection && current.state.selection.node.type.name === "reference") {
          const dom = current.nodeDOM(current.state.selection.from);
          if (dom instanceof HTMLElement) actions.current.setInspect({ node: current.state.selection.node, position: current.state.selection.from, target: dom });
          return true;
        }
        latest.current.props.onKeyDown?.(event, handle.current);
        if (event.defaultPrevented) return true;
        const modifier = event.ctrlKey || event.metaKey;
        if (modifier && !event.altKey && ["b", "i", "`"].includes(event.key.toLowerCase())) {
          const type = current.state.schema.marks[event.key === "`" ? "code" : event.key.toLowerCase() === "b" ? "strong" : "em"];
          event.preventDefault(); return toggleMark(type)(current.state, current.dispatch, current);
        }
        if (modifier && event.altKey && /^[0-6]$/.test(event.key)) {
          const level = Number(event.key), type = current.state.schema.nodes[level ? "heading" : "paragraph"];
          event.preventDefault(); return setBlockType(type, level ? { level } : null)(current.state, current.dispatch, current);
        }
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
        if (modifier && event.key.toLowerCase() === "a") { current.dispatch(current.state.tr.setSelection(TextSelection.between(current.state.doc.resolve(0), current.state.doc.resolve(current.state.doc.content.size)))); return true; }
        const continueList = () => splitListItem(current.state.schema.nodes.list_item, current.state.selection.$from.node(-1)?.type.name === "list_item" && current.state.selection.$from.node(-1).attrs.checked !== null ? { checked: false } : undefined)(current.state, current.dispatch, current);
        if (event.key === "Enter" && event.shiftKey) {
          if (continueList()) return true;
          const node = current.state.selection.$from.parent;
          current.dispatch(node.type.spec.code ? current.state.tr.insertText("\n").scrollIntoView() : current.state.tr.replaceSelectionWith(current.state.schema.nodes.hard_break.create(), true).scrollIntoView()); return true;
        }
        if (event.key === "Enter" && continueList()) return true;
        if (["Backspace", "Delete"].includes(event.key)) {
          if (event.key === "Backspace" && undoInputRule(current.state, current.dispatch)) return true;
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
        current.dispatch(closeHistory(current.state.tr).replaceSelection(insertionSlice(source)).scrollIntoView()); return true;
      },
    });
    viewRef.current = view;
    if (replay.current?.focused) view.focus();
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
          result += node.type.name === "reference" ? referencePresentation(node, latest.current.context).text : node.isText ? node.text : node.type.name === "hard_break" ? "\n" : ["inline_math", "math_block"].includes(node.type.name) ? node.attrs.tex : node.type.name === "image" ? node.attrs.alt : readable(node.content);
        }); return result;
      };
      event.preventDefault();
      event.clipboardData.setData("text/plain", readable(fragment));
      event.clipboardData.setData(clipboardType, JSON.stringify({ library: latest.current.workspace?.profile.id, source: referenceClipboardSource(fragment) }));
      if (cut) current.dispatch(closeHistory(current.state.tr).deleteSelection());
      return true;
    }
    return () => { replay.current = { state: view.state, focused: view.hasFocus() }; cancelAnimationFrame(frame.current); cancelAnimationFrame(blurFrame.current); view.destroy(); viewRef.current = null; };
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
  useLayoutEffect(() => { if (sourceValue !== null) { sourceInput.current?.focus({ preventScroll: true }); sourceInput.current?.setSelectionRange(0, 0); } }, [sourceValue]);
  const toggleSource = () => {
    const view = viewRef.current; if (!view) return;
    clearMention(); setInspect(null);
    if (!sourceModeRef.current) { sourceModeRef.current = true; setSourceValue(referenceDocumentSource(view.state.doc)); }
    else {
      const doc = createReferenceDocument(sourceInput.current?.value ?? sourceValue ?? "");
      view.dispatch(closeHistory(view.state.tr).replaceWith(0, view.state.doc.content.size, doc.content));
      sourceModeRef.current = false; setSourceValue(null); requestAnimationFrame(() => viewRef.current?.focus());
    }
  };

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
  const closeInspection = (restore = false, nextTarget?: EventTarget | null) => {
    const current = inspectionRef.current;
    setInspect(null);
    if (restore) { if (current?.detail) current.target.focus({ preventScroll: true }); else viewRef.current?.focus(); }
    // Pointer dismissal runs before the clicked editor receives focus. Keep its live
    // document mounted so the browser can place the caret at that original target.
    else if (!sessionContains(nextTarget ?? null) && !viewRef.current?.hasFocus()) {
      if (nextTarget) {
        cancelAnimationFrame(blurFrame.current);
        blurFrame.current = requestAnimationFrame(() => {
          if (!viewRef.current?.hasFocus()) actions.current.finishBlur(document.activeElement);
        });
      } else latest.current.props.onBlur?.(handle.current);
    }
  };
  const changeReference = (source: string) => {
    const current = inspectionRef.current, view = viewRef.current;
    if (!current || !view || !view.state.doc.nodeAt(current.position)?.eq(current.node)) { closeInspection(true); return; }
    const replacement: EditorNode[] = [];
    insertionSlice(source).content.forEach(node => replacement.push(node.mark(current.node.marks)));
    const content = Fragment.from(replacement);
    const transaction: Transaction = closeHistory(view.state.tr).replaceWith(current.position, current.position + current.node.nodeSize, content);
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(current.position + content.size)));
    view.dispatch(transaction); closeInspection(true);
  };
  const sourceToggle = !props.className?.includes("research-table-cell-editor") && <button ref={viewToggle} type="button" data-ui="icon-action" className="research-text-view-toggle" aria-label={sourceValue === null ? t("编辑 Markdown 源码") : t("返回排版编辑")} title={sourceValue === null ? t("编辑 Markdown 源码") : t("返回排版编辑")}
    onPointerDown={event => event.preventDefault()} onClick={toggleSource}
    onBlur={event => { if (!sessionContains(event.relatedTarget)) actions.current.finishBlur(event.relatedTarget); }}>{sourceValue === null ? <Code2 size={14} /> : <Pilcrow size={14} />}</button>;
  return <><div ref={attachRoot} className={["research-reference-editor", props.className].filter(Boolean).join(" ")} style={props.style}>
    <div ref={mount} hidden={sourceValue !== null} />
    {sourceValue !== null && <textarea ref={sourceInput} className="research-text-source research-markdown-source" aria-label={props["aria-label"]} defaultValue={sourceValue} spellCheck={false}
      onBlur={event => { if (!sessionContains(event.relatedTarget)) actions.current.finishBlur(event.relatedTarget); }}
      onKeyDown={event => { if (!event.nativeEvent.isComposing) props.onKeyDown?.(event.nativeEvent, handle.current); }} />}
    {!toolsHost && sourceToggle}
    </div>
    {toolsHost && createPortal(sourceToggle, toolsHost)}
    {mention && <MentionPicker key={id + mention.kind} id={id} popupRef={popup} getAnchor={() => viewRef.current!.coordsAtPos(viewRef.current!.state.selection.from)} kind={mention.kind} choices={choices} total={choices.length} active={active} listRef={list} onActiveChange={setActive} query={search}
      onQuery={query => { setSearch(query); setActive(""); }} onPick={pick} onCancel={cancelMention}
      onKeyDown={event => { mentionKeys(event.nativeEvent); }} onComposition={value => { searchComposing.current = value; }}
      onSessionBlur={event => { if (!sessionContains(event.relatedTarget)) finishBlur(event.relatedTarget); }} />}
    {inspection && createPortal(<div ref={panel} onBlur={event => {
      if (!event.relatedTarget) return;
      if (!sessionContains(event.relatedTarget)) finishBlur(event.relatedTarget);
    }}>{inspection.detail ? <ReferenceDetails inspection={inspection} onCancel={closeInspection} /> : <ResearchReferencePopover node={inspection.node} target={inspection.target} onApply={changeReference} onDelete={() => changeReference("")} onCancel={closeInspection} />}</div>, inspection.target.closest("dialog") ?? document.body)}
  </>;
});
export default ResearchReferenceEditor;

function ReferenceDetails({ inspection, onCancel }: { inspection: Inspection; onCancel: (restore?: boolean, nextTarget?: EventTarget | null) => void }) {
  const context = useContext(ResearchNoteLinkContext), id = dictionaryReferenceId(inspection.node.attrs.href);
  const term = context?.terms.find(entry => entry.id === id);
  if (inspection.node.attrs.kind === "term" && term) return <ResearchTermPopover entry={term} target={inspection.target} onCancel={onCancel} />;
  if (!context) return null;
  const symbol = context.symbols.find(entry => entry.id === id);
  const bindings = { ...Object.fromEntries((symbol?.slots ?? []).map(slot => [slot.key, slot.defaultValue])), ...dictionaryReferenceBindings(inspection.node.attrs.href) };
  return <FormulaSymbolPopover state={context.state} part={{ type: "symbol", entryId: id!, bindings }} target={inspection.target} onCancel={onCancel}
    onOpenFormula={address => { onCancel(); context.openNote(address.noteId, address.formulaId, inspection.target); }} />;
}
