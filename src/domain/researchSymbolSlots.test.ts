import { describe, expect, it } from "vitest";
import { createResearchNotebook, normalizeResearchNotebook } from "./researchNotebook.ts";
import { createSymbolEntry, normalizeSymbolEntries, resolveSymbolEntry } from "./researchDictionary.ts";
import { legacyBindingsToPositions, toPositionalSymbol } from "./researchSymbolPositions.ts";

describe("three positional symbol slots", () => {
  it("preserves independent descriptions including deliberately blank values", () => {
    const state = createResearchNotebook(), original = state.symbols[0];
    const slots = original.slots.map((slot,index)=>({...slot,description:["次数说明 $p$。\n第二行。","对象编号。","自变量说明。"][index]}));
    const entry = createSymbolEntry({...original,meaning:"本体说明。",slots},"descriptions");
    state.symbols.push(entry);
    const restored = normalizeResearchNotebook(JSON.parse(JSON.stringify(state))).symbols.at(-1)!;
    expect(restored).toEqual(entry);
    expect(toPositionalSymbol(entry)).toEqual(entry);
    expect(normalizeSymbolEntries([{...entry,slots:slots.map(slot=>({...slot,description:""}))}])[0].slots.every(slot=>slot.description==="")).toBe(true);
    expect(normalizeSymbolEntries([{...entry,slots:slots.map(slot=>({...slot,description:7}))}])[0].slots.every(slot=>slot.description===undefined)).toBe(true);
  });

  it("inserts all positions literally and omits empty positions", () => {
    const rate = createSymbolEntry({name:"变化率",meaning:"测试",notation:"\\dot{q}",category:"custom",slots:[]});
    expect(resolveSymbolEntry(rate,{x1:"(p)",x2:"j+1",x3:"(t)"}).tex).toBe("\\dot{q}^{(p)}_{j+1}(t)");
    expect(resolveSymbolEntry(rate,{x1:"p",x2:"",x3:"[t]"}).tex).toBe("\\dot{q}^{p}[t]");
    expect(resolveSymbolEntry(rate,{}).tex).toBe("\\dot{q}");
  });

  it("converts compound indices and complete arguments from stored templates", () => {
    const entry = {id:"old",name:"复合量",meaning:"保持说明",category:"custom" as const,notation:"q^{\\mathrm{in}}_{[group],[index]}([time]\\mid s)",slots:[
      {key:"group",label:"组",domain:"generic" as const,defaultValue:"A"},
      {key:"index",label:"编号",domain:"generic" as const,defaultValue:"i"},
      {key:"time",label:"时间",domain:"time" as const,defaultValue:"t"},
    ]};
    expect(legacyBindingsToPositions(entry,{group:"B",index:"j",time:"u"})).toEqual({x1:"\\mathrm{in}",x2:"B,j",x3:"(u\\mid s)"});
    expect(toPositionalSymbol(entry)).toMatchObject({notation:"q^{[x1]}_{[x2]}[x3]",meaning:entry.meaning});
  });

  it("uses three optional positions for every new example and custom definition", () => {
    for (const entry of [...createResearchNotebook().symbols,createSymbolEntry({name:"量",meaning:"测试",notation:"q",category:"custom",slots:[]})]) {
      expect(entry.slots.map(slot=>slot.key)).toEqual(["x1","x2","x3"]);
      expect(entry.slots.every(slot=>slot.optional && !slot.placement)).toBe(true);
    }
  });
});
