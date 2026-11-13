import { describe, expect, it } from "vitest";
import katex from "katex";
import { createResearchNotebook } from "./researchNotebook.ts";
import { addSymbolEntry, createSymbolEntry, deleteSymbolEntry, formulaPartsToTex, listSymbolUses, normalizeSymbolEntries, resolveSymbolEntry, symbolEntryError, updateSymbolEntry, type FormulaPart } from "./researchDictionary.ts";
import { positionSlots } from "./researchSymbolPositions.ts";
import { scanResearchDictionaryText } from "./researchTerms.ts";

describe("general dictionary", () => {
  it("keeps starter IDs unique and saved definitions distinct from defaults", () => {
    const state = createResearchNotebook();
    expect(new Set(state.symbols.map(entry => entry.id)).size).toBe(state.symbols.length);
    const custom = { ...state.symbols[0], meaning: "我的解释" };
    expect(normalizeSymbolEntries([state.symbols[0], custom])).toEqual([custom]);
    expect(normalizeSymbolEntries([])).toEqual([]);
  });

  it("renders literal scripts and right arguments from one definition", () => {
    const entry = createResearchNotebook().symbols[0];
    expect(resolveSymbolEntry(entry, {x1:"(p)",x2:"j+1",x3:"[t]"})).toMatchObject({tex:"x^{(p)}_{j+1}[t]",missingSlots:[]});
    expect(resolveSymbolEntry(entry, {}).tex).toBe("x");
    expect(resolveSymbolEntry(entry, {x1:"p^{}",x3:"(t)_{ }"}).tex).toBe("x^{p^{}}(t)_{ }");
  });

  it("renders decorated vector bodies without changing mathematical convention", () => {
    for (const base of ["\\mathbf{x}", "\\boldsymbol{x}", "\\dot{\\boldsymbol{x}}", "\\widehat{q}"]) {
      const entry = createSymbolEntry({name:"变量",meaning:"测试",category:"custom",notation:base,slots:[]});
      const {tex} = resolveSymbolEntry(entry,{x2:"i",x3:"(t)"});
      expect(tex).toBe(base+"_{i}(t)");
      expect(() => katex.renderToString(tex,{throwOnError:true})).not.toThrow();
    }
  });

  it("composes dictionary references, known operators and multiple aligned lines", () => {
    const {symbols} = createResearchNotebook();
    const x: FormulaPart = {type:"symbol",entryId:"example-x",bindings:{}};
    const y: FormulaPart = {type:"symbol",entryId:"example-y",bindings:{x2:"i"}};
    const row: FormulaPart[] = [y,{type:"alignmentPoint"},{type:"operator",operator:"equals"},x];
    expect(formulaPartsToTex([...row,{type:"lineBreak"},...row],symbols)).toEqual({tex:"\\begin{aligned}y_{i}&=x\\\\y_{i}&=x\\end{aligned}",errors:[]});
    expect(formulaPartsToTex([{type:"symbol",entryId:"missing",bindings:{}}],symbols).errors).toEqual(["缺少符号词条：missing"]);
    expect(formulaPartsToTex(row,symbols,"centered").errors).toContain("居中多行公式不能包含对齐点");
  });

  it("requires three declared positions and rejects duplicate definitions", () => {
    const {symbols} = createResearchNotebook(), entry = symbols[0];
    expect(symbolEntryError({...entry,id:"duplicate"},symbols)).toContain("相同的符号模板");
    expect(symbolEntryError({...entry,notation:"x_i",slots:[]},[])).toContain("三个位置");
    expect(symbolEntryError({...entry,slots:positionSlots()},[])).toBeNull();
  });

  it("protects referenced entries and permits removing a custom unused entry", () => {
    const state = createResearchNotebook();
    expect(listSymbolUses(state.notes,"example-x").length).toBeGreaterThan(0);
    expect(deleteSymbolEntry(state,"example-x")).toBe(state);
    const custom = createSymbolEntry({name:"额外变量",meaning:"测试",notation:"z",category:"custom",slots:[]},"custom");
    const added = addSymbolEntry(state,custom);
    expect(added.symbols.at(-1)).toEqual(custom);
    expect(deleteSymbolEntry(added,custom.id).symbols).toEqual(state.symbols);
  });

  it("retains unknown notation and invalidates consumers after a definition edit", () => {
    const state = createResearchNotebook();
    state.notes = state.notes.map(note=>({...note,reviewStatus:"reviewed"}));
    const original = state.symbols.find(entry=>entry.id==="example-x")!;
    const next = updateSymbolEntry(state,{...original,meaning:"更新含义"});
    expect(next.notes.find(note=>note.id==="mewiki-example-foundation")?.reviewStatus).toBe("pending");
    expect(original.meaning).not.toBe("更新含义");
    const custom = createSymbolEntry({name:"未知变量",meaning:"测试",notation:"q_{[index]}",category:"custom",slots:[{key:"index",label:"编号",domain:"generic",defaultValue:"i"}]});
    expect(resolveSymbolEntry(custom,{x2:"j"}).tex).toBe("q_{j}");
  });

  it("keeps renamed symbol names as aliases for legacy consistency checks", () => {
    const state = createResearchNotebook();
    const original = state.symbols.find(entry => entry.id === "example-x")!;
    const renamed = updateSymbolEntry(state, { ...original, name: "新的输入变量" });
    expect(renamed.symbols.find(entry => entry.id === original.id)?.aliases).toContain(original.name);
    expect(normalizeSymbolEntries([{ ...original, aliases: ["旧名称", "旧名称"] }])[0].aliases).toEqual(["旧名称"]);
    expect(scanResearchDictionaryText(`正文使用${original.name}。`, renamed.symbols, [])).toMatchObject([{ kind: "symbol", entryId: original.id, matchedText: original.name }]);
  });
});
