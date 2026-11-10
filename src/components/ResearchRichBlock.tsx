import { useLocale } from "../i18n/react.ts";
import { t } from "../i18n/locale.ts";
import { lazy, Suspense } from "react";
import type { ResearchRichContentBlock } from "../domain/researchRichContent.ts";

const ResearchCitationBlock = lazy(() => import("./ResearchCitationBlock.tsx"));
const ResearchDatasetBlock = lazy(() => import("./ResearchDatasetBlock.tsx"));
const ResearchDiagramBlock = lazy(() => import("./ResearchDiagramBlock.tsx"));

export default function ResearchRichBlock({ block, readOnly = false, onPatch }: {
  block: ResearchRichContentBlock; readOnly?: boolean; onPatch: (patch: Partial<ResearchRichContentBlock>) => void;
}) {
  useLocale();
  return <Suspense fallback={<p role="status">{t("正在打开内容…")}</p>}>
    {block.type === "citation" ? <ResearchCitationBlock block={block} readOnly={readOnly} onPatch={onPatch} />
      : block.type === "dataset" ? <ResearchDatasetBlock block={block} readOnly={readOnly} onPatch={onPatch} />
        : <ResearchDiagramBlock block={block} readOnly={readOnly} onPatch={onPatch} />}
  </Suspense>;
}
