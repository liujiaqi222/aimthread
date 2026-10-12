"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { ConfirmationDialog } from "@/components/confirmation-dialog";

type Guard = { finish: () => Promise<boolean> };
const NavigationContext = createContext<{
  register: (guard: Guard) => () => void;
  request: (navigate: () => void) => boolean;
}>({
  register: () => () => {},
  request: () => false,
});

export function SessionNavigationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const guardRef = useRef<Guard | null>(null);
  const destinationRef = useRef<(() => void) | null>(null);
  const pendingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const register = useCallback((guard: Guard) => {
    guardRef.current = guard;
    return () => {
      if (guardRef.current === guard) guardRef.current = null;
    };
  }, []);
  const request = useCallback((navigate: () => void) => {
    if (!guardRef.current) return false;
    if (!destinationRef.current) {
      destinationRef.current = navigate;
      setError(null);
      setOpen(true);
    }
    return true;
  }, []);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!guardRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  // Intercept traversal before popstate, when App Router would restore
  // the target tree and unmount the running panel.
  useEffect(() => {
    const navigation = (
      window as Window & {
        navigation?: EventTarget & { traverseTo: (key: string) => unknown };
      }
    ).navigation;
    if (!navigation) return;
    const onNavigate = (event: Event) => {
      const traversal = event as Event & {
        navigationType: string;
        destination: { key: string; url: string; sameDocument: boolean };
      };
      if (
        !guardRef.current ||
        traversal.navigationType !== "traverse" ||
        !traversal.destination.sameDocument ||
        !event.cancelable ||
        new URL(traversal.destination.url).pathname === window.location.pathname
      )
        return;
      event.preventDefault();
      request(() => navigation.traverseTo(traversal.destination.key));
    };
    navigation.addEventListener("navigate", onNavigate);
    return () => navigation.removeEventListener("navigate", onNavigate);
  }, [request]);

  const confirm = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const guard = guardRef.current;
      if (guard && !(await guard.finish())) {
        setError("结束保存失败，请重试。当前计时和笔记已保留。");
        return;
      }
      guardRef.current = null;
      const navigate = destinationRef.current;
      destinationRef.current = null;
      setOpen(false);
      navigate?.();
    } catch {
      setError("连接失败，请重试。当前计时和笔记已保留。");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <NavigationContext.Provider value={{ register, request }}>
      {children}
      {open && (
        <ConfirmationDialog
          titleId="leave-session-title"
          title="计时进行中"
          description="离开当前页面将结束计时，并保存已投入的时间。确定要离开吗？"
          cancelLabel="继续计时"
          confirmLabel="结束并离开"
          pending={pending}
          error={error}
          onClose={() => {
            if (pendingRef.current) return;
            destinationRef.current = null;
            setOpen(false);
          }}
          onConfirm={() => void confirm()}
        />
      )}
    </NavigationContext.Provider>
  );
}

export function useSessionNavigation() {
  return useContext(NavigationContext);
}

export function SessionLink(props: React.ComponentProps<typeof Link>) {
  const { request } = useSessionNavigation();
  const router = useRouter();
  return (
    <Link
      {...props}
      onNavigate={(event) => {
        props.onNavigate?.(event);
        const href =
          typeof props.href === "string" ? props.href : props.href.pathname;
        if (
          !href ||
          new URL(href, window.location.href).pathname ===
            window.location.pathname
        )
          return;
        if (
          request(() => {
            if (props.replace) router.replace(href, { scroll: props.scroll });
            else router.push(href, { scroll: props.scroll });
            router.refresh();
          })
        )
          event.preventDefault();
      }}
    />
  );
}
