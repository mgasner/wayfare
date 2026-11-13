import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "accent" | "outline" | "ghost" | "dark";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "md" | "sm" | "lg";
  block?: boolean;
  icon?: ReactNode;
  /** Square icon-only button; pass an aria-label. */
  iconOnly?: boolean;
}

export function Button({ variant = "outline", size = "md", block, icon, iconOnly, className, children, type = "button", ...rest }: ButtonProps) {
  const cls = ["btn", `btn-${variant}`, `btn-${size}`, block && "btn-block", iconOnly && "btn-icon", className].filter(Boolean).join(" ");
  return (
    <button type={type} className={cls} {...rest}>
      {icon}
      {children}
    </button>
  );
}

export function Chip({ on, onClick, children, icon, className }: { on?: boolean; onClick?: () => void; children: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <button type="button" className={`chip${on ? " chip-on" : ""}${className ? ` ${className}` : ""}`} aria-pressed={on} onClick={onClick}>
      {icon}
      {children}
    </button>
  );
}
