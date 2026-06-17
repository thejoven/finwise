import * as React from "react";

// 「聚焦到用户」: 全局选中一个用户后, 各域页按其 user_id 收窄 (运营/排障).
// 存 sessionStorage, 跨页/刷新在本会话内保持; 登出不残留 (会话级).

export interface FocusedUser {
  id: string;
  email: string;
}

interface Ctx {
  focused: FocusedUser | null;
  focus: (u: FocusedUser) => void;
  clear: () => void;
}

const FocusedUserContext = React.createContext<Ctx | null>(null);
const KEY = "wiseflow.admin.focusedUser";

export function FocusedUserProvider({ children }: { children: React.ReactNode }) {
  const [focused, setFocused] = React.useState<FocusedUser | null>(() => {
    try {
      const s = sessionStorage.getItem(KEY);
      return s ? (JSON.parse(s) as FocusedUser) : null;
    } catch {
      return null;
    }
  });

  const focus = React.useCallback((u: FocusedUser) => {
    setFocused(u);
    try {
      sessionStorage.setItem(KEY, JSON.stringify(u));
    } catch {
      /* ignore */
    }
  }, []);

  const clear = React.useCallback(() => {
    setFocused(null);
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <FocusedUserContext.Provider value={{ focused, focus, clear }}>
      {children}
    </FocusedUserContext.Provider>
  );
}

export function useFocusedUser() {
  const ctx = React.useContext(FocusedUserContext);
  if (!ctx) throw new Error("useFocusedUser must be used within FocusedUserProvider");
  return ctx;
}
