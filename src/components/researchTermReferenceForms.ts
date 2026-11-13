import { formatTermReference, termReferenceFormats, type ResearchTermEntry, type TermReferenceForm, type TermReferenceSelection } from "../domain/researchTerms.ts";
import { t } from "../i18n/locale.ts";

export const termReferenceForms: readonly TermReferenceForm[] = ["name", "english", "chinese-abbreviation", "english-abbreviation", "alias", "full"];

export function termReferenceFormLabel(form: TermReferenceForm): string {
  switch (form) {
    case "name": return t("术语名称");
    case "english": return t("仅英文名称");
    case "chinese-abbreviation": return t("仅中文缩写");
    case "english-abbreviation": return t("仅英文缩写");
    case "alias": return t("别名／英文别称");
    case "full": return t("规范全称（名称、英文名称与英文缩写）");
  }
}

export function termReferenceOptionValue(selection: TermReferenceSelection): string {
  return selection.form === "alias" && selection.aliasId ? `alias:${selection.aliasId}` : selection.form;
}

export function termReferenceFormOptions(entry: ResearchTermEntry) {
  const available = termReferenceFormats(entry);
  return termReferenceForms.flatMap(form => {
    const selections = available.filter(selection => selection.form === form);
    const disabled = selections.length === 0;
    return (disabled ? [{ form }] : selections).map(selection => ({
      selection,
      value: termReferenceOptionValue(selection),
      label: `${termReferenceFormLabel(form)} · ${disabled ? t("未填写") : formatTermReference(entry, selection)}`,
      disabled,
    }));
  });
}
