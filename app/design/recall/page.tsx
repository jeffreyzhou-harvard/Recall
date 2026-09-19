"use client";
import { useState } from "react";

/** Development-only device review. The iframe has a real 390px CSS viewport. */
export default function RecallDeviceReview() {
  const [route, setRoute] = useState("/");
  const [width, setWidth] = useState(390);
  return <main style={{ background: "#eef1f4", minHeight: "100vh", padding: 20, color: "#080808", fontFamily: "sans-serif" }}>
    <div style={{ display: "flex", gap: 20, marginBottom: 20, alignItems: "center", flexWrap: "wrap" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Recall · phone review</h1>
      <label>Page <select aria-label="Preview page" value={route} onChange={(event) => setRoute(event.target.value)} style={{ background: "white", padding: 10, border: "1px solid black" }}><option value="/">Call</option><option value="/caregiver">Caregiver</option><option value="/onboarding">Setup</option><option value="/revisit">Next conversation</option></select></label>
      <label>Width <select aria-label="Phone width" value={width} onChange={(event) => setWidth(Number(event.target.value))} style={{ background: "white", padding: 10, border: "1px solid black" }}><option value={390}>390 px</option><option value={320}>320 px</option></select></label>
    </div>
    <iframe key={route} src={route} title="Recall phone preview" style={{ display: "block", width, height: 844, marginInline: "auto", border: "1px solid #080808", background: "white" }} />
  </main>;
}
