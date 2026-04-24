"use client";

import React from "react";

export const Spinner = (): React.ReactNode => (
  <span className="spinner" aria-label="Loading" />
);

export const BrandMark = (): React.ReactNode => (
  <span className="brand-mark logo-lockup" aria-hidden="true">
    <img src="/kindred-wordmark.svg" alt="" />
  </span>
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: string;
  small?: boolean;
}

export const Button = ({
  children,
  className = "",
  variant = "",
  small = false,
  ...props
}: ButtonProps): React.ReactNode => (
  <button
    className={`button ${variant} ${small ? "small" : ""} ${className}`.trim()}
    {...props}
  >
    {children}
  </button>
);
