import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Accessible name for the dialog. */
  label: string;
  /** Sheet height on phones; the content scrolls inside. */
  height?: "auto" | "tall";
}

/** Bottom sheet on phones (drag the handle down to close), centered panel on desktop. */
export function Sheet({ open, onClose, children, label, height = "auto" }: SheetProps) {
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const onPointerDown = (e: React.PointerEvent) => {
    start.current = e.clientY;
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (start.current !== null) setDrag(Math.max(0, e.clientY - start.current));
  };
  const onPointerUp = () => {
    if (drag > 90) onClose();
    start.current = null;
    setDrag(0);
  };

  return createPortal(
    <div className="sheet-root">
      <div className="sheet-backdrop" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`sheet sheet-${height}`}
        style={drag ? { transform: `translateY(${drag}px)`, transition: "none" } : undefined}
      >
        <div className="sheet-handle" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          <span />
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
