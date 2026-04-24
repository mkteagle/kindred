"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface FocalPointDialogProps {
  photoUrl: string;
  photoTitle: string;
  initialCrop: { x: number; y: number } | null;
  onSetFocalPoint: (crop: { x: number; y: number }) => void;
  onClose: () => void;
}

export function FocalPointDialog({
  photoUrl,
  photoTitle,
  initialCrop,
  onSetFocalPoint,
  onClose,
}: FocalPointDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [focalPoint, setFocalPoint] = useState<{ x: number; y: number } | null>(
    initialCrop
  );
  const [imgLoaded, setImgLoaded] = useState(false);

  // Open dialog on mount
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  // Close on escape handled by dialog natively, but we sync state
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => onClose();
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose]);

  // Zoom with scroll wheel
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.15 : 0.15;
      setZoom((z) => Math.max(0.25, Math.min(5, z + delta)));
    },
    []
  );

  // Pan with mouse drag
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only pan on middle-click or when holding space, otherwise it's a focal click
      if (e.button === 1 || e.altKey) {
        e.preventDefault();
        setDragging(true);
        setDragStart({ x: e.clientX, y: e.clientY });
        setPanStart({ ...pan });
      }
    },
    [pan]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging) return;
      e.preventDefault();
      setPan({
        x: panStart.x + (e.clientX - dragStart.x),
        y: panStart.y + (e.clientY - dragStart.y),
      });
    },
    [dragging, dragStart, panStart]
  );

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  // Click to set focal point (left click, no alt)
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (dragging) return;
      const img = imgRef.current;
      if (!img) return;

      const rect = img.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;

      // Clamp to 0-100
      const fx = Math.max(0, Math.min(100, Math.round(x)));
      const fy = Math.max(0, Math.min(100, Math.round(y)));

      setFocalPoint({ x: fx, y: fy });
    },
    [dragging]
  );

  const hasChanges = focalPoint !== null && (
    !initialCrop || focalPoint.x !== initialCrop.x || focalPoint.y !== initialCrop.y
  );

  const handleSave = () => {
    if (focalPoint) {
      onSetFocalPoint(focalPoint);
    }
    onClose();
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <dialog
      ref={dialogRef}
      style={{
        position: "fixed",
        inset: 0,
        width: "min(92vw, 900px)",
        height: "min(88vh, 700px)",
        maxWidth: "none",
        maxHeight: "none",
        margin: "auto",
        padding: 0,
        border: "none",
        borderRadius: 14,
        background: "var(--paper, #fffdf8)",
        boxShadow: "0 20px 60px rgba(0,0,0,.3), 0 4px 16px rgba(0,0,0,.12)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
      onClick={(e) => {
        // Close on backdrop click
        if (e.target === dialogRef.current) onClose();
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 18px",
          borderBottom: "1px solid var(--line)",
          flexShrink: 0,
        }}
      >
        <div>
          <h3
            style={{
              margin: 0,
              fontFamily: "var(--display)",
              fontSize: 16,
              color: "var(--ash)",
            }}
          >
            Set focal point
          </h3>
          <p
            style={{
              margin: "2px 0 0",
              fontSize: 11,
              color: "var(--mist)",
              fontFamily: "var(--mono)",
            }}
          >
            Click to place &middot; Scroll to zoom &middot; Alt+drag to pan
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Zoom controls */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              background: "rgba(18, 18, 24, .04)",
              borderRadius: 6,
              padding: "2px 4px",
            }}
          >
            <button
              onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
              style={{
                width: 26,
                height: 26,
                border: "none",
                borderRadius: 4,
                background: "transparent",
                fontSize: 16,
                color: "var(--mist)",
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
              }}
              title="Zoom out"
            >
              &minus;
            </button>
            <span
              style={{
                minWidth: 42,
                textAlign: "center",
                fontSize: 11,
                fontFamily: "var(--mono)",
                fontWeight: 600,
                color: "var(--ash)",
              }}
            >
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom((z) => Math.min(5, z + 0.25))}
              style={{
                width: 26,
                height: 26,
                border: "none",
                borderRadius: 4,
                background: "transparent",
                fontSize: 16,
                color: "var(--mist)",
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
              }}
              title="Zoom in"
            >
              +
            </button>
            <button
              onClick={resetView}
              style={{
                padding: "0 6px",
                height: 26,
                border: "none",
                borderRadius: 4,
                background: "transparent",
                fontSize: 10,
                fontFamily: "var(--mono)",
                fontWeight: 600,
                color: "var(--mist)",
                cursor: "pointer",
              }}
              title="Reset zoom"
            >
              Fit
            </button>
          </div>

          {focalPoint && (
            <span
              style={{
                fontSize: 11,
                fontFamily: "var(--mono)",
                fontWeight: 600,
                color: "var(--gold)",
                padding: "4px 8px",
                background: "rgba(233, 184, 93, .1)",
                borderRadius: 5,
              }}
            >
              {focalPoint.x}, {focalPoint.y}
            </span>
          )}

          <button
            onClick={onClose}
            style={{
              padding: "5px 12px",
              borderRadius: 6,
              border: "1px solid var(--line)",
              background: "transparent",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--mist)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges}
            style={{
              padding: "5px 14px",
              borderRadius: 6,
              border: "none",
              background: hasChanges ? "var(--gold)" : "rgba(233, 184, 93, .3)",
              fontSize: 12,
              fontWeight: 700,
              color: "#fff",
              cursor: hasChanges ? "pointer" : "default",
              opacity: hasChanges ? 1 : 0.6,
            }}
          >
            Save
          </button>
        </div>
      </div>

      {/* Canvas area + preview */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Main image area */}
        <div
          ref={containerRef}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{
            flex: 1,
            overflow: "hidden",
            background: "rgba(18, 18, 24, .05)",
            cursor: dragging ? "grabbing" : "crosshair",
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            onClick={handleClick}
            style={{
              position: "relative",
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "center center",
              transition: dragging ? "none" : "transform .1s ease-out",
              willChange: "transform",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={photoUrl}
              alt={photoTitle}
              onLoad={() => setImgLoaded(true)}
              draggable={false}
              style={{
                display: "block",
                maxWidth: "100%",
                maxHeight: "calc(88vh - 120px)",
                objectFit: "contain",
                userSelect: "none",
              }}
            />

            {/* Focal point crosshair */}
            {focalPoint && imgLoaded && (
              <div
                style={{
                  position: "absolute",
                  left: `${focalPoint.x}%`,
                  top: `${focalPoint.y}%`,
                  transform: `translate(-50%, -50%) scale(${1 / zoom})`,
                  pointerEvents: "none",
                  zIndex: 10,
                }}
              >
                {/* Crosshair */}
                <div style={{ position: "relative", width: 32, height: 32 }}>
                  {/* Horizontal line */}
                  <div
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: -8,
                      right: -8,
                      height: 1.5,
                      background: "var(--gold)",
                      boxShadow: "0 0 4px rgba(0,0,0,.3)",
                    }}
                  />
                  {/* Vertical line */}
                  <div
                    style={{
                      position: "absolute",
                      left: "50%",
                      top: -8,
                      bottom: -8,
                      width: 1.5,
                      background: "var(--gold)",
                      boxShadow: "0 0 4px rgba(0,0,0,.3)",
                    }}
                  />
                  {/* Outer ring */}
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      borderRadius: "50%",
                      border: "2px solid var(--gold)",
                      boxShadow:
                        "0 0 0 1px rgba(0,0,0,.15), inset 0 0 0 1px rgba(0,0,0,.1)",
                    }}
                  />
                  {/* Center dot */}
                  <div
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: "50%",
                      transform: "translate(-50%, -50%)",
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "var(--gold)",
                      boxShadow: "0 0 8px rgba(233, 184, 93, .6)",
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Preview sidebar */}
        <div
          style={{
            width: 200,
            borderLeft: "1px solid var(--line)",
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 14,
            flexShrink: 0,
            overflow: "auto",
          }}
        >
          <div>
            <span
              style={{
                fontSize: 10,
                fontFamily: "var(--mono)",
                fontWeight: 600,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                color: "var(--mist)",
                display: "block",
                marginBottom: 8,
              }}
            >
              Card preview
            </span>
            {/* Square crop preview — mimics how the cluster card looks */}
            <div
              style={{
                width: "100%",
                aspectRatio: "4 / 3",
                borderRadius: 8,
                overflow: "hidden",
                border: "1px solid var(--line)",
                background: "rgba(18, 18, 24, .04)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoUrl}
                alt=""
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: focalPoint
                    ? `${focalPoint.x}% ${focalPoint.y}%`
                    : "center center",
                }}
              />
            </div>
          </div>

          <div>
            <span
              style={{
                fontSize: 10,
                fontFamily: "var(--mono)",
                fontWeight: 600,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                color: "var(--mist)",
                display: "block",
                marginBottom: 8,
              }}
            >
              Square crop
            </span>
            <div
              style={{
                width: "100%",
                aspectRatio: "1",
                borderRadius: 8,
                overflow: "hidden",
                border: "1px solid var(--line)",
                background: "rgba(18, 18, 24, .04)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoUrl}
                alt=""
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: focalPoint
                    ? `${focalPoint.x}% ${focalPoint.y}%`
                    : "center center",
                }}
              />
            </div>
          </div>

          <p
            style={{
              fontSize: 11,
              color: "var(--mist)",
              lineHeight: 1.5,
              margin: 0,
            }}
          >
            The focal point determines which part of the photo stays visible when cropped on cards.
          </p>
        </div>
      </div>
    </dialog>
  );
}
