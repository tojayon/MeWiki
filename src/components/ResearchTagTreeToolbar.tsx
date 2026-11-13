import { useContext } from "react";
import { ResearchTagTreeToolbarContext } from "./ResearchTagTreeToolbarContext.ts";

export default function ResearchTagTreeToolbar() {
  const toolbar = useContext(ResearchTagTreeToolbarContext);
  return <div ref={toolbar?.setTarget} className="research-category-tools" />;
}
