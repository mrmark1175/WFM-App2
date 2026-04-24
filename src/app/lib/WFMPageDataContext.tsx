import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

const Ctx = createContext<{
  pageData: unknown;
  setPageData: (data: unknown) => void;
}>({ pageData: null, setPageData: () => {} });

export function WFMPageDataProvider({ children }: { children: ReactNode }) {
  const [pageData, setPageData] = useState<unknown>(null);
  return <Ctx.Provider value={{ pageData, setPageData }}>{children}</Ctx.Provider>;
}

export function useWFMPageData() {
  return useContext(Ctx);
}
