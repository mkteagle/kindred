import type { ReactNode } from "react";

type Props = {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
};

export function PageHeader({ title, subtitle, actions }: Props) {
  return (
    <header
      className="sticky top-0 z-10 px-7 py-4 flex items-end justify-between gap-4"
      style={{
        background: "var(--color-paper)",
        borderBottom: "1px solid var(--line)",
        backdropFilter: "saturate(140%) blur(6px)",
      }}
    >
      <div className="min-w-0">
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 22,
            letterSpacing: "-0.01em",
            color: "var(--color-ash)",
            lineHeight: 1.1,
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <div
            className="mt-1"
            style={{
              fontSize: 12.5,
              color: "var(--color-mist)",
              lineHeight: 1.4,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}
