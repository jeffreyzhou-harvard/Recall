"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Flower2, Heart } from "lucide-react";
import { AccessGate, SignOut } from "@/components/live/AccessGate";
import { StoryRecorder } from "./StoryRecorder";
import { post, type CircleView } from "./types";
import "./circle.css";
function Remember() {
  const [data, setData] = useState<CircleView | null>(null),
    [error, setError] = useState(""),
    [index, setIndex] = useState(0),
    [photoIndex, setPhotoIndex] = useState(0);
  async function refresh() {
    const r = await fetch("/api/circle/state", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    setData(d);
    return d as CircleView;
  }
  useEffect(() => {
    void refresh()
      .then((d) => {
        const target = new URLSearchParams(location.search).get("moment");
        const i = d.moments.findIndex((m) => m.id === target);
        if (i >= 0) setIndex(i);
      })
      .catch((e) => setError(e.message));
  }, []);
  if (!data)
    return (
      <main className="circle-entry">
        <Flower2 size={40} />
        <h1>A familiar moment awaits.</h1>
        <p role={error ? "alert" : "status"}>
          {error || "Opening your photographs…"}
        </p>
        {error && (
          <button
            className="circle-button primary"
            onClick={() => {
              setError("");
              void refresh().catch((e) => setError(e.message));
            }}
          >
            Reload photographs
          </button>
        )}
      </main>
    );
  const moment = data.moments[index],
    photos = data.photos.filter((p) => moment?.photoIds.includes(p.id)),
    photo = photos[photoIndex] || photos[0];
  return (
    <main className="circle-remember">
      <header>
        <Link href={data.canManage ? "/caregiver" : "/revisit"}>
          <Flower2 />
          recall<span>·</span>
        </Link>
        <span>A little time for you, {data.name}.</span>
        <SignOut />
      </header>
      {!moment ? (
        <div className="circle-entry">
          <Heart size={42} />
          <h1>Your family’s photographs will be here.</h1>
          <p>
            There’s nothing you need to do. Come back when someone has added a
            photo.
          </p>
        </div>
      ) : (
        <>
          <div className="circle-remember-layout">
            <div className="circle-remember-image">
              {photo && (
                <img src={photo.url} alt={photo.caption || moment.title} />
              )}{" "}
              {photos.length > 1 && (
                <div className="circle-photo-dots">
                  {photos.map((p, i) => (
                    <button
                      key={p.id}
                      aria-label={`Photograph ${i + 1}`}
                      aria-pressed={i === photoIndex}
                      onClick={() => setPhotoIndex(i)}
                    />
                  ))}
                </div>
              )}
            </div>
            <section className="circle-remember-story" key={moment.id}>
              <p className="circle-eyebrow">A MOMENT TO COME BACK TO</p>
              <h1>{moment.title}</h1>
              <p className="circle-remember-question">
                {moment.question ||
                  "What comes to mind when you see this photograph?"}
              </p>
              <p>
                There’s no right answer. Share as much or as little as you like.
              </p>
              <StoryRecorder
                momentId={moment.id}
                name={data.name}
                onSaved={async () => {
                  await refresh();
                }}
              />
            </section>
          </div>
          <footer>
            <button
              className="circle-button secondary"
              disabled={index === 0}
              onClick={() => {
                setIndex(index - 1);
                setPhotoIndex(0);
              }}
            >
              <ArrowLeft size={20} />
              Previous moment
            </button>
            <span>
              {index + 1} of {data.moments.length}
            </span>
            <button
              className="circle-button secondary"
              disabled={index === data.moments.length - 1}
              onClick={() => {
                setIndex(index + 1);
                setPhotoIndex(0);
              }}
            >
              Another moment
              <ArrowRight size={20} />
            </button>
          </footer>
          <p className="circle-remember-note">
            Your words stay yours. Shared only with your family.
          </p>
          {data.people.find((p) => p.id === data.member)?.contact?.phone && (
            <label className="circle-remember-reminders">
              <input
                type="checkbox"
                checked={
                  data.people.find((p) => p.id === data.member)?.contact
                    ?.reminders === 1
                }
                onChange={(e) => {
                  void post("preferences", { reminders: e.target.checked })
                    .then(refresh)
                    .catch((e) => setError(e.message));
                }}
              />
              Occasional photo invitations by text
            </label>
          )}
          {error && (
            <p className="circle-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
      {data.people.find((p) => p.id === data.member)?.role === "participant" && (
        <p className="circle-remember-note"><Link href="/conversations/call">Open scheduled conversations</Link></p>
      )}
    </main>
  );
}
export function PhotoRemember() {
  return (
    <AccessGate anyRole>
      <Remember />
    </AccessGate>
  );
}
