import { describe, expect, it } from "vitest";
import { createResearchNotebook, createResearchNote, deleteResearchNote, normalizeResearchNotebook, parseResearchMarkdown, serializeResearchMarkdown, updateResearchNote } from "./researchNotebook.ts";
import { libraryNotes, noteBasisIds, openLibraryNote, prepareLibraryNote, selectNoteLibrary, setLibraryFilters, setNoteBasis, setNoteLibrary } from "./researchNoteLibraries.ts";
import { buildResearchTheoryGraph, theoryReferenceKey } from "./researchTheoryMap.ts";

const basis="mewiki-example-foundation", record="mewiki-example-content";
describe("foundation and research note libraries", () => {
  it("keeps separate selection and filters while navigating", () => {
    let state=openLibraryNote(createResearchNotebook(),record);
    state=setLibraryFilters(state,{query:"记录",status:"all",tag:""});
    state=openLibraryNote(state,basis);
    state=setLibraryFilters(state,{query:"关系",status:"pending",tag:""});
    expect(libraryNotes(state).map(note=>note.id)).toEqual([basis]);
    state=selectNoteLibrary(state,"research");
    expect(state.activeNoteId).toBe(record); expect(state.noteFilters?.query).toBe("记录");
    state=selectNoteLibrary(state,"foundation");
    expect(state.activeNoteId).toBe(basis); expect(state.foundationFilters?.query).toBe("关系");
  });

  it("protects cited theory and invalidates dependent reviews after source edits", () => {
    const base=createResearchNotebook(), note=createResearchNote("新推导");
    let state=setNoteBasis({...base,notes:[...base.notes,note]},note.id,[basis]);
    state={...state,notes:state.notes.map(item=>item.id===note.id?{...item,reviewStatus:"reviewed"}:item)};
    expect(noteBasisIds(state.notes.at(-1)!)).toEqual([basis]);
    expect(deleteResearchNote(state,basis)).toBe(state);
    expect(updateResearchNote(state,basis,{title:"更新定义"}).notes.at(-1)?.reviewStatus).toBe("pending");
    const graph=buildResearchTheoryGraph({...state,view:"maps"},{scope:"global"});
    expect(graph.edges).toContainEqual(expect.objectContaining({source:theoryReferenceKey({noteId:basis}),target:theoryReferenceKey({noteId:note.id})}));
  });

  it("preserves explicit ownership and type through storage and Markdown", () => {
    const state=createResearchNotebook(), note={...state.notes[0],library:"foundation" as const,researchType:"derivation" as const};
    const next=normalizeResearchNotebook({...state,view:"foundations",notes:[note],activeNoteId:note.id});
    expect(next.view).toBe("foundations"); expect(next.notes[0].library).toBe("foundation");
    expect(parseResearchMarkdown(serializeResearchMarkdown(note))).toMatchObject({library:"foundation",researchType:"derivation"});
    expect(setNoteLibrary(next,note.id,"research").notes[0].library).toBe("research");
  });

  it("does not recreate deleted notes or rewrite content moved by the user", () => {
    const state=createResearchNotebook();
    const notes=state.notes.filter(note=>note.id!==basis).map(note=>({...note,library:"foundation" as const}));
    const next=normalizeResearchNotebook({...state,notes,noteLibraryVersion:undefined});
    expect(next.notes).toEqual(notes); expect(next.noteLibraryVersion).toBe(1);
  });

  it("prepares a blank foundation template without subject-specific prose", () => {
    const note=prepareLibraryNote(createResearchNote("定义"),"foundation");
    expect(note.library).toBe("foundation");
    expect(note.blocks.filter(block=>block.type==="heading").map(block=>block.text)).toEqual(["标准结论","成立条件","文献出处","证明摘要（可选）"]);
    expect(note.blocks.filter(block=>block.type==="paragraph").every(block=>block.text==="")).toBe(true);
  });
});
