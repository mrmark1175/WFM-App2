import { createContext, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";

interface WFMPageDataContextType {
  pageData: unknown;
  setPageData: (data: unknown) => void;
  pendingPrompt: string | null;
  setPendingPrompt: (p: string | null) => void;
  triggerOpenAssistant: () => void;
  registerOpenAssistant: (fn: () => void) => void;
}

const Ctx = createContext<WFMPageDataContextType>({
  pageData: null,
  setPageData: () => {},
  pendingPrompt: null,
  setPendingPrompt: () => {},
  triggerOpenAssistant: () => {},
  registerOpenAssistant: () => {},
});

export function WFMPageDataProvider({ children }: { children: ReactNode }) {
  const [pageData, setPageData] = useState<unknown>(null);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const openFnRef = useRef<(() => void) | null>(null);

  const registerOpenAssistant = (fn: () => void) => { openFnRef.current = fn; };
  const triggerOpenAssistant = () => { openFnRef.current?.(); };

  return (
    <Ctx.Provider value={{ pageData, setPageData, pendingPrompt, setPendingPrompt, triggerOpenAssistant, registerOpenAssistant }}>
      {children}
    </Ctx.Provider>
  );
}

export function useWFMPageData() {
  return useContext(Ctx);
}
