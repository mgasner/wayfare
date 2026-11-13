import { Children, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

export interface SwipePagerProps {
  index: number;
  onIndexChange: (i: number) => void;
  children: ReactNode;
  className?: string;
  /** Accessible name, e.g. "Trip setup pages". */
  label: string;
}

/**
 * Horizontal pages that swipe with native scroll snapping. The index is controlled: buttons
 * and dots set it, and a finished swipe reports the page it settled on.
 */
export function SwipePager({ index, onIndexChange, children, className, label }: SwipePagerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const settled = useRef(index);
  const pages = Children.toArray(children);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ left: index * el.clientWidth, behavior: "instant" });
    settled.current = index;
    // Only on mount: later index changes animate in the effect below.
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || settled.current === index) return;
    settled.current = index;
    el.scrollTo({ left: index * el.clientWidth, behavior: "smooth" });
  }, [index]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
      if (i !== settled.current) {
        settled.current = i;
        onIndexChange(i);
      }
    };
    // scrollend is missing in Safari before 18, so a short idle timer stands in for it.
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(settle, 120);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const onResize = () => el.scrollTo({ left: settled.current * el.clientWidth, behavior: "instant" });
    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(timer);
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [onIndexChange]);

  return (
    <div ref={ref} className={`pager ${className ?? ""}`} role="region" aria-roledescription="carousel" aria-label={label}>
      {pages.map((p, i) => (
        <div key={i} className="pager-page" role="group" aria-roledescription="page" aria-label={`${i + 1} of ${pages.length}`} aria-hidden={i !== index}>
          {p}
        </div>
      ))}
    </div>
  );
}

export function PagerDots({ count, index, onPick }: { count: number; index: number; onPick?: (i: number) => void }) {
  return (
    <div className="pager-dots" role="tablist">
      {Array.from({ length: count }, (_, i) => (
        <button key={i} type="button" role="tab" aria-selected={i === index} aria-label={`Page ${i + 1}`} className={i === index ? "on" : ""} onClick={() => onPick?.(i)} />
      ))}
    </div>
  );
}
