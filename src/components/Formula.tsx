import { memo, useMemo } from "react";
import katex from "katex";

export const Formula = memo(function Formula({
  tex,
  block = false,
  className = "",
  interactive = false,
  markedTex,
}: {
  tex: string;
  block?: boolean;
  className?: string;
  interactive?: boolean;
  markedTex?: string;
}) {
  const html = useMemo(
    () => {
      const rendered = katex.renderToString(markedTex ?? tex, {
        displayMode: block,
        throwOnError: false,
        output: "htmlAndMathml",
        trust: interactive ? (context) => context.command === "\\htmlClass" : undefined,
        strict: interactive ? "ignore" : undefined,
      });
      if (markedTex === undefined) return rendered;
      // Presentation markers must never change the original accessible math tree.
      const semantics = katex.renderToString(tex, { displayMode: block, throwOnError: false, output: "mathml" }).match(/<math[\s\S]*?<\/math>/)?.[0] ?? "";
      return rendered.replace(/<math[\s\S]*?<\/math>/, () => semantics);
    },
    [tex, block, interactive, markedTex],
  );
  return (
    <span
      className={`formula ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
