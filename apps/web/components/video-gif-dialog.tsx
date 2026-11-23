"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { captureGifFrames, encodeGif, gifClip, MAX_GIF_DURATION, type GifProgress } from "@/lib/video-gif";
import { CloseIcon } from "@/components/kx/icons";
import styles from "./video-gif-dialog.module.css";

type Props = { src: string; title: string; initialStart: number; onClose: () => void };

export default function VideoGifDialog({ src, title, initialStart, onClose }: Props) {
  const heading = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const job = useRef<AbortController | null>(null);
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState("");
  const [length, setLength] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<GifProgress | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const startNumber = Number(start);
  const lengthNumber = Number(length);
  const minLength = Math.min(0.1, duration);
  const valid = duration > 0 && start !== "" && length !== "" && startNumber >= 0 &&
    lengthNumber >= minLength && lengthNumber <= MAX_GIF_DURATION && startNumber + lengthNumber <= duration + 0.00001;
  const filename = `${title.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[\\/:*?"<>|]/g, "-").trim().slice(0, 110) || "Kindred clip"}.gif`;

  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  useEffect(() => () => job.current?.abort(), []);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result); }, [result]);

  function loadMetadata(element: HTMLVideoElement) {
    if (!Number.isFinite(element.duration) || element.duration <= 0) {
      setError("Kindred couldn’t read the duration of this video.");
      return;
    }
    const clip = gifClip(element.duration, initialStart, 3);
    const rangeStart = Math.floor(clip.start * 100) / 100;
    const rangeLength = Math.max(Math.min(0.1, element.duration), Math.min(3, Math.floor((element.duration - rangeStart) * 100) / 100));
    setDuration(element.duration);
    setStart(rangeStart.toString());
    setLength(rangeLength.toString());
    element.currentTime = rangeStart;
  }

  function usePlayhead() {
    if (!video.current) return;
    const clip = gifClip(duration, video.current.currentTime, Math.max(0.1, lengthNumber));
    const rangeStart = Math.floor(clip.start * 100) / 100;
    setStart(rangeStart.toString());
    setLength(Math.max(minLength, Math.floor(Math.min(clip.length, duration - rangeStart) * 100) / 100).toString());
    setResult(null);
  }

  async function create() {
    const source = video.current;
    if (!source || !valid || job.current) return;
    const controller = new AbortController();
    job.current = controller;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const captured = await captureGifFrames(source, startNumber, lengthNumber, controller.signal, setProgress);
      controller.signal.throwIfAborted();
      setProgress(null);
      const gif = await encodeGif(captured, controller.signal);
      controller.signal.throwIfAborted();
      setResult(URL.createObjectURL(gif));
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(failure instanceof Error ? failure.message : "The GIF couldn’t be created. Try again.");
      }
    } finally {
      if (job.current === controller) job.current = null;
      if (dialog.current?.open) {
        setBusy(false);
        setProgress(null);
      }
    }
  }

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={heading}
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
      <div className={styles.header}>
        <h2 id={heading}>Create a GIF</h2>
        <button type="button" className="kx-iconbutton" aria-label="Close GIF editor" onClick={onClose}>
          <CloseIcon size={18} />
        </button>
      </div>
      <video ref={video} src={src} controls={!busy} playsInline preload="metadata"
        onLoadedMetadata={(event) => loadMetadata(event.currentTarget)}
        onError={() => setError("This video could not be opened for editing.")} />
      <div className={styles.fields}>
        <label>
          Start (seconds)
          <input type="number" inputMode="decimal" step="any" min={0} max={duration} value={start}
            disabled={!duration || busy}
            onChange={(event) => { setStart(event.target.value); setResult(null); }} />
        </label>
        <label>
          Length (seconds)
          <input type="number" inputMode="decimal" step="any" min={minLength} max={MAX_GIF_DURATION} value={length}
            disabled={!duration || busy}
            onChange={(event) => { setLength(event.target.value); setResult(null); }} />
        </label>
        <button type="button" className="kx-button" disabled={!duration || busy} onClick={usePlayhead}>Use playhead</button>
      </div>
      {!!duration && !valid && <p className={styles.hint}>Choose a clip within the video, up to {MAX_GIF_DURATION} seconds long.</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {busy && <p className={styles.hint} role="status">{progress
        ? `Capturing frames ${progress.captured} of ${progress.total}`
        : "Encoding GIF…"}</p>}
      {result && <img className={styles.preview} src={result} alt="Animated GIF preview" />}
      <div className={styles.actions}>
        {busy && <button type="button" className="kx-button" onClick={() => job.current?.abort()}>Cancel export</button>}
        {result
          ? <a className="kx-button primary" href={result} download={filename}>Download GIF</a>
          : <button type="button" className="kx-button primary" onClick={() => void create()} disabled={!valid || busy}>
            {busy ? "Creating…" : "Create GIF"}
          </button>}
      </div>
    </dialog>
  );
}
