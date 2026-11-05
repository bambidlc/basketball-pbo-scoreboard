import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";

const listeners = new Set<() => void>();

export function navigate(to: string, { replace = false } = {}) {
  if (to === window.location.pathname + window.location.search) return;
  if (replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  listeners.forEach((fn) => fn());
  if (!to.includes("#")) window.scrollTo({ top: 0 });
}

export function useLocation() {
  const [loc, setLoc] = useState(() => ({ path: window.location.pathname, search: window.location.search }));
  useEffect(() => {
    const update = () => setLoc({ path: window.location.pathname, search: window.location.search });
    listeners.add(update);
    window.addEventListener("popstate", update);
    return () => {
      listeners.delete(update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return loc;
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return (
    <a
      href={to}
      {...rest}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        if (to.startsWith("#")) return;
        event.preventDefault();
        navigate(to);
      }}
    />
  );
}
