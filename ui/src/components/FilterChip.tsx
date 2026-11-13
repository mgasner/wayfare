import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Sheet } from "./Sheet";

export interface FilterOption<T extends string> {
  value: T;
  label: string;
  sub?: string;
}

/** A chip showing the current choice; tapping opens a sheet with the options. */
export function FilterChip<T extends string>({
  label,
  value,
  options,
  onChange,
  icon,
  grid,
}: {
  label: string;
  value: T;
  options: FilterOption<T>[];
  onChange: (v: T) => void;
  icon?: ReactNode;
  grid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o.value === value);
  const active = value !== options[0]?.value;
  return (
    <>
      <button type="button" className={`chip${active ? " chip-on" : ""}`} onClick={() => setOpen(true)} aria-haspopup="dialog">
        {icon}
        {active ? cur?.label : label}
        <ChevronDown size={14} />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} label={label}>
        <div className="filter-sheet">
          <div className="label muted">{label}</div>
          <div className={grid ? "filter-grid" : "filter-list"}>
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`filter-opt${o.value === value ? " on" : ""}`}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                <span>{o.label}</span>
                {o.sub && <span className="muted">{o.sub}</span>}
              </button>
            ))}
          </div>
        </div>
      </Sheet>
    </>
  );
}
