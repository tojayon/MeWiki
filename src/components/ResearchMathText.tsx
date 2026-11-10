import { useLocale } from "../i18n/react.ts";
import ResearchMarkdown from "./ResearchMarkdown.tsx";

export default function ResearchMathText({ text }: { text: string }) {
  useLocale();
  return <ResearchMarkdown text={text} inline />;
}
