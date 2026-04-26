"use client";

import React from "react";

interface WebToggleProps {
  on: boolean;
  onChange: (val: boolean) => void;
  color?: string;
  disabled?: boolean;
}

/**
 * WebToggle - 40x22 pill toggle per the design spec.
 * On: colored bg (default --forest), knob at right.
 * Off: muted bg, knob at left.
 */
export function WebToggle({ on, onChange, color, disabled }: WebToggleProps) {
  return (
    <button
      role="switch"
      aria-checked={on}
      className={`wtoggle ${on ? "wtoggle-on" : ""} ${disabled ? "wtoggle-disabled" : ""}`}
      style={on && color ? { "--wtoggle-color": color } as React.CSSProperties : undefined}
      onClick={() => !disabled && onChange(!on)}
      disabled={disabled}
    >
      <span className="wtoggle-knob" />
    </button>
  );
}
