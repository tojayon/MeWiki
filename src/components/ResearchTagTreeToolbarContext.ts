import { createContext } from "react";

export const ResearchTagTreeToolbarContext = createContext<{
  target: HTMLElement | null;
  setTarget: (target: HTMLDivElement | null) => void;
} | null>(null);
