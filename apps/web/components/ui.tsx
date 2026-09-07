"use client";

import React from "react";
import { BrandWordmark } from "@/components/brand-mark";

export const Spinner = ({ size }: { size?: number } = {}): React.ReactNode => (
  <span className="spinner" aria-label="Loading" style={size ? { width: size, height: size } : undefined} />
);

export const BrandMark = (): React.ReactNode => (
  <span className="brand-mark logo-lockup" aria-hidden="true">
    <BrandWordmark alt="" />
  </span>
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: string;
  small?: boolean;
  large?: boolean;
  loading?: boolean;
  loadingText?: string;
}

export const Button = ({
  children,
  className = "",
  variant = "",
  small = false,
  large = false,
  loading = false,
  loadingText,
  disabled,
  ...props
}: ButtonProps): React.ReactNode => (
  <button
    className={`button ${variant} ${small ? "small" : ""} ${large ? "lg" : ""} ${className}`.trim()}
    disabled={disabled || loading}
    {...props}
  >
    {loading ? (
      <>
        <Spinner />
        {loadingText && <span>{loadingText}</span>}
      </>
    ) : (
      children
    )}
  </button>
);

/** Eye toggle icon for password fields */
export function EyeIcon({ open }: { open: boolean }): React.ReactNode {
  if (open) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
