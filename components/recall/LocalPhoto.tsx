"use client";
import { useEffect, useState } from "react";

export function LocalPhoto({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  // Local browser-selected photo, never sent to a server or image optimizer.
  return url ? <img src={url} alt={file.name} /> : <span>Loading photo</span>;
}
