import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { TopBar } from "./components/Brand";
import { CenterLoad } from "./components/ui";
import type { MePayload } from "./types";

type PortalCtx = { me: MePayload; refresh: () => Promise<MePayload | undefined>; setMe: (me: MePayload) => void };
const Ctx = createContext<PortalCtx | null>(null);

let cached: MePayload | undefined;

export function PortalLayout({ children }: { children: ReactNode }) {
  const [me, setMeState] = useState<MePayload | undefined>(cached);
  const setMe = useCallback((value: MePayload) => {
    cached = value;
    setMeState(value);
  }, []);
  const refresh = useCallback(async () => {
    try {
      const value = await api.get<MePayload>("/api/me");
      setMe(value);
      return value;
    } catch {
      return undefined;
    }
  }, [setMe]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <>
      <TopBar clubName={me?.club.name || " "} />
      {me ? <Ctx.Provider value={{ me, refresh, setMe }}>{children}</Ctx.Provider> : <CenterLoad />}
    </>
  );
}

export function usePortal() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePortal outside PortalLayout");
  return ctx;
}

export function clearPortalCache() {
  cached = undefined;
}
