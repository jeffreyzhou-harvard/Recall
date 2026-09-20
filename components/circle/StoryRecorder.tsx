"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Mic, Square, Type, Upload } from "lucide-react";
import { post } from "./types";
export function StoryRecorder({
  momentId,
  name,
  onSaved,
  apiBase = "/api/circle",
}: {
  momentId: string;
  name: string;
  onSaved: () => Promise<void>;
  apiBase?: string;
}) {
  const [text, setText] = useState(""),
    [audio, setAudio] = useState<{ id: string; url: string } | null>(null),
    [recording, setRecording] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [writing, setWriting] = useState(false),
    [seconds, setSeconds] = useState(0),
    [saved, setSaved] = useState(false),
    [played, setPlayed] = useState(false);
  const mounted = useRef(true),
    requesting = useRef(false);
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    chunks = useRef<Blob[]>([]),
    request = useRef(crypto.randomUUID()),
    draft = useRef<string | null>(null);
  function discard(id: string) {
    void fetch(apiBase + "/discard-audio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }), keepalive: true }).catch(() => {});
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (recorder.current?.state === "recording") {
        recorder.current.onstop = null;
        recorder.current.stop();
      }
      stream.current?.getTracks().forEach((t) => t.stop());
      if (draft.current) discard(draft.current);
    };
  }, []);
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);
  useEffect(() => {
    if (seconds >= 180 && recorder.current?.state === "recording")
      recorder.current.stop();
  }, [seconds]);
  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("audio", file);
      const r = await fetch(apiBase + "/audio", {
        method: "POST",
        body: form,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      if (!mounted.current) { discard(d.id); return; }
      if (draft.current) discard(draft.current);
      draft.current = d.id;
      setAudio({ id: d.id, url: d.url });
      setText(d.text);
      setWriting(true);
      setPlayed(false);
      if (d.warning) setError(d.warning);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "We couldn’t save the recording. You can write instead.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function record() {
    if (requesting.current) return;
    setError("");
    if (recording) {
      recorder.current?.stop();
      return;
    }
    requesting.current = true;
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw new Error(
          "Recording is not available in this browser. You can write or choose an audio file.",
        );
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      if (!mounted.current) {
        stream.current.getTracks().forEach((t) => t.stop());
        return;
      }
      const type = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((t) => MediaRecorder.isTypeSupported(t));
      const r = new MediaRecorder(
        stream.current,
        type ? { mimeType: type } : undefined,
      );
      recorder.current = r;
      chunks.current = [];
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      r.onstop = () => {
        stream.current?.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const mime = r.mimeType || "audio/webm";
        void upload(
          new File(
            chunks.current,
            "memory." +
              (mime.includes("mp4")
                ? "m4a"
                : mime.includes("ogg")
                  ? "ogg"
                  : "webm"),
            { type: mime },
          ),
        );
      };
      r.start();
      setRecording(true);
      setSeconds(0);
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      setError(
        e instanceof Error
          ? e.message
          : "Microphone access is unavailable. You can write your story instead.",
      );
    } finally {
      requesting.current = false;
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      await post("story", {
        momentId,
        text,
        requestId: request.current,
        audioId: audio?.id,
        confirmed: true,
        audioReviewed: !audio || played,
      }, apiBase);
      draft.current = null;
      await onSaved();
      setSaved(true);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Your story could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (saved)
    return (
      <div className="circle-story-success" role="status">
        <Check size={28} />
        <h3>A little more of the story, kept.</h3>
        <p>
          Your words are now part of this moment, with your name beside them.
        </p>
        <button
          className="circle-text-button"
          onClick={() => {
            setSaved(false);
            setWriting(false);
            setText("");
            setAudio(null);
            request.current = crypto.randomUUID();
          }}
        >
          Add another detail
        </button>
      </div>
    );
  return (
    <div className="circle-recorder">
      <div className="circle-record-actions">
        <button
          className={`circle-button ${recording ? "recording" : "primary"}`}
          onClick={() => void record()}
          disabled={busy}
        >
          {recording ? <Square size={20} /> : <Mic size={20} />}{" "}
          {recording
            ? `Finish recording · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
            : busy
              ? "Saving your recording…"
              : "Tell the story"}
        </button>
        <button
          className="circle-text-button"
          onClick={() => setWriting(!writing)}
          disabled={busy || recording}
        >
          <Type size={18} />
          Write instead
        </button>
      </div>
      {recording && (
        <div className="circle-record-wave" aria-label="Recording">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      )}
      {writing && (
        <div className="circle-story-editor">
          {audio && (
            <>
              <p>Listen back. These are your original words.</p>
              <audio controls src={audio.url} onEnded={() => setPlayed(true)} />
              <label className="circle-check">
                <input
                  type="checkbox"
                  checked={played}
                  onChange={(e) => setPlayed(e.target.checked)}
                />
                I’ve reviewed my recording.
              </label>
            </>
          )}
          <label>
            Your story
            <textarea
              rows={5}
              value={text}
              maxLength={6000}
              placeholder="The detail only you remember…"
              onChange={(e) => setText(e.target.value)}
              disabled={busy}
            />
          </label>
          <p className="circle-fine">
            Shared with your family as {name}. Nothing is rewritten in your
            voice.
          </p>
          <button
            className="circle-button primary"
            onClick={() => void save()}
            disabled={busy || !text.trim() || (!!audio && !played)}
          >
            <Check size={18} />
            {busy ? "Saving…" : "Save to family"}
          </button>
          <label className="circle-audio-file">
            <Upload size={15} />
            Or choose a recording
            <input
              type="file"
              accept="audio/*"
              disabled={busy || recording}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
          </label>
        </div>
      )}
      {error && (
        <p className="circle-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
