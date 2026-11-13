import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface ToastInput {
  text: string;
  /** Label and handler for the one action, usually Undo. */
  action?: { label: string; run: () => void | Promise<void> };
  durationMs?: number;
}

interface ToastState extends ToastInput {
  id: number;
}

const ToastContext = createContext<(t: ToastInput) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const seq = useRef(0);
  const show = useCallback((t: ToastInput) => setToast({ ...t, id: ++seq.current }), []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast((cur) => (cur?.id === toast.id ? null : cur)), toast.durationMs ?? 8000);
    return () => clearTimeout(id);
  }, [toast]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast &&
        createPortal(
          <div className="toast" role="status" key={toast.id}>
            <span className="grow">{toast.text}</span>
            {toast.action && (
              <button
                type="button"
                className="toast-action"
                onClick={async () => {
                  setToast(null);
                  await toast.action!.run();
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
