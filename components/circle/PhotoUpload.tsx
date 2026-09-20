"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Check,
  ImagePlus,
  Layers3,
  Upload,
  X,
} from "lucide-react";
import { ArchiveDialog } from "@/components/archive/ArchiveDialog";
import { post } from "./types";
type Receipt = {
  added: number;
  duplicates: number;
  moments: number;
  rejected: { name: string; reason: string }[];
  warning: string | null;
};
export function PhotoUpload({
  onClose,
  onDone,
  sample = false,
  demo = false,
}: {
  onClose: () => void;
  onDone: () => Promise<void>;
  sample?: boolean;
  demo?: boolean;
}) {
  const [files, setFiles] = useState<{ file: File; url: string }[]>([]),
    [busy, setBusy] = useState(false),
    [grouping, setGrouping] = useState(false),
    [error, setError] = useState(""),
    [receipt, setReceipt] = useState<Receipt | null>(null),
    [sent, setSent] = useState(0),
    [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    urls = useRef<string[]>([]),
    requestId = useRef(crypto.randomUUID()),
    started = useRef(false),
    reduced = useReducedMotion();
  useEffect(() => () => urls.current.forEach(URL.revokeObjectURL), []);
  function choose(selected: FileList | File[]) {
    setError("");
    requestId.current = crypto.randomUUID();
    setFiles((current) => {
      const incoming = Array.from(selected).filter(
        (f) =>
          !current.some(
            (p) =>
              p.file.name === f.name &&
              p.file.size === f.size &&
              p.file.lastModified === f.lastModified,
          ),
      );
      if (current.length + incoming.length > 80)
        setError("You can add 80 photos at a time. The first 80 are selected.");
      return [
        ...current,
        ...incoming.slice(0, 80 - current.length).map((file) => {
          const url = URL.createObjectURL(file);
          urls.current.push(url);
          return { file, url };
        }),
      ];
    });
  }
  async function start(useSample = false) {
    if (busy) return;
    setBusy(true);
    setGrouping(false);
    setError("");
    setSent(0);
    try {
      let result: Receipt;
      if (useSample) {
        result = await post<Receipt>("sample", {});
      } else {
        const form = new FormData();
        form.set("requestId", requestId.current);
        files.forEach((p) => form.append("photos", p.file));
        result = await new Promise<Receipt>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/circle/photos");
          xhr.timeout = 180000;
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable)
              setSent(Math.round((e.loaded / e.total) * 100));
          };
          xhr.onload = () => {
            try {
              const d = JSON.parse(xhr.responseText);
              if (xhr.status < 200 || xhr.status >= 300)
                reject(new Error(d.error || "The upload was interrupted."));
              else resolve(d);
            } catch {
              reject(
                new Error(
                  "The upload was interrupted. Your selection is still here.",
                ),
              );
            }
          };
          xhr.onerror = () =>
            reject(
              new Error(
                "Connection interrupted. Your photos are still selected.",
              ),
            );
          xhr.ontimeout = () =>
            reject(
              new Error(
                "This batch is taking longer than expected. You can retry safely.",
              ),
            );
          xhr.send(form);
        });
      }
      // Keep the demo's grouping reveal visible even when its fixture upload is instant.
      if (demo && result.added > 0) {
        setSent(100);
        setGrouping(true);
        await Promise.all([onDone(), new Promise<void>(resolve => window.setTimeout(resolve, 3000))]);
      } else {
        await onDone();
      }
      setReceipt(result);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Your photos could not be added.",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (sample && !started.current) {
      started.current = true;
      void start(true);
    }
  }, [sample]);
  return (
    <ArchiveDialog title="Add photos" onClose={onClose} busy={busy}>
      <div className="circle-upload">
        <AnimatePresence mode="wait">
          {receipt ? (
            <motion.div
              key="done"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="circle-import-done"
            >
              <span className="circle-success-icon">
                <Check size={30} />
              </span>
              <h2>
                {receipt.added
                  ? `${receipt.added} photos.\n${receipt.moments} ${receipt.moments === 1 ? "moment" : "moments"}.`
                  : receipt.rejected.length ? "These photos couldn’t be added." : "Already part of the family."}
              </h2>
              <p>
                {receipt.added
                  ? "Grouped, named, and ready to rediscover."
                  : receipt.rejected.length ? "Check the details below and choose another photo batch." : "These photos are already in your collection."}
              </p>
              {receipt.duplicates > 0 && (
                <p className="circle-muted">
                  {receipt.duplicates}{" "}
                  {receipt.duplicates === 1
                    ? "duplicate was"
                    : "duplicates were"}{" "}
                  gently skipped.
                </p>
              )}
              {receipt.warning && (
                <p className="circle-notice">{receipt.warning}</p>
              )}
              {receipt.rejected.length > 0 && (
                <details className="circle-notice">
                  <summary>
                    {receipt.rejected.length} photos couldn’t be opened
                  </summary>
                  {receipt.rejected.map((r, i) => (
                    <p key={i}>
                      {r.name}: {r.reason}
                    </p>
                  ))}
                </details>
              )}
              <button className="circle-button primary" onClick={onClose}>
                See your moments
                <ArrowRight size={19} />
              </button>
            </motion.div>
          ) : busy ? (
            <motion.div
              key="busy"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="circle-processing"
              role="status"
              aria-live="polite"
            >
              <div className="circle-photo-dance">
                {(sample
                  ? [
                      "/sample-family/beach-01.jpg",
                      "/preview/princeton-garden.png",
                      "/preview/lincoln-library.png",
                    ]
                  : files.map((f) => f.url)
                )
                  .slice(0, 6)
                  .map((src, i) => (
                    <motion.img
                      key={`${src}:${grouping ? "grouping" : "uploading"}`}
                      src={src}
                      alt=""
                      initial={{
                        x: 0,
                        y: 0,
                        rotate: 0,
                        scale: 0.6,
                        opacity: 0,
                      }}
                      animate={{
                        x: Math.cos(i * 1.4) * 75,
                        y: Math.sin(i * 1.4) * 45,
                        rotate: (i - 2) * 8,
                        scale: 1,
                        opacity: 1,
                      }}
                      transition={{
                        duration: reduced ? 0 : grouping ? 2.5 : 0.8,
                        delay: reduced ? 0 : i * 0.1,
                        ease: [0.2, 0.8, 0.2, 1],
                      }}
                    />
                  ))}
                <span>
                  <Layers3 size={24} aria-hidden="true" />
                </span>
              </div>
              <h2>
                {sent < 100 && !sample
                  ? "Bringing your photos in."
                  : "Finding the moments."}
              </h2>
              <p>
                {sent < 100 && !sample
                  ? "Original photos stay safe in your family collection."
                  : "Looking at places, dates, and the details that belong together."}
              </p>
              <div className="circle-progress">
                <motion.span
                  initial={{ x: "-100%" }}
                  animate={reduced ? {} : { x: "330%" }}
                  transition={{
                    repeat: Infinity,
                    duration: 1.8,
                    ease: "easeInOut",
                  }}
                />
              </div>
              <span className="circle-muted">
                {sent > 0 && sent < 100
                  ? `${sent}% uploaded`
                  : "You can leave the naming and sorting to Recall."}
              </span>
            </motion.div>
          ) : (
            <motion.div
              key="choose"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <h2>Just bring the photographs.</h2>
              <p>
                We’ll find the moments, give them a name, and make room for the
                stories.
              </p>
              <button
                className={`circle-dropzone ${drag ? "dragging" : ""}`}
                onClick={() => input.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDrag(false);
                  choose(e.dataTransfer.files);
                }}
              >
                <span className="circle-drop-icon">
                  <ImagePlus size={30} />
                </span>
                <strong>
                  {files.length ? "Add a few more" : "Drop your photos here"}
                </strong>
                <span>or choose from your device</span>
                <small>JPEG, PNG, WebP, HEIC · up to 80 photos</small>
              </button>
              <input
                ref={input}
                type="file"
                multiple
                accept="image/*,.heic,.heif"
                hidden
                onChange={(e) => {
                  if (e.target.files) choose(e.target.files);
                  e.target.value = "";
                }}
              />
              {files.length > 0 && (
                <>
                  <div className="circle-upload-grid">
                    {files.map((p, i) => (
                      <div key={p.url}>
                        <img src={p.url} alt={p.file.name} />
                        <button
                          aria-label={`Remove ${p.file.name}`}
                          onClick={() => {
                            requestId.current = crypto.randomUUID();
                            setFiles((f) => f.filter((_, n) => n !== i));
                          }}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    className="circle-button primary wide"
                    onClick={() => void start()}
                  >
                    <Layers3 size={18} aria-hidden="true" />
                    Organize {files.length} photos
                    <ArrowRight size={18} />
                  </button>
                </>
              )}
              <p className="circle-fine">
                OpenAI helps recognize settings and events. Original words
                always come from your family.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
        {error && (
          <p className="circle-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </ArchiveDialog>
  );
}
