"use client";
import { RecallWordmark } from "@/components/recall/RecallFrame";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  AudioLines,
  BookOpen,
  Camera,
  Check,
  Images,
  MapPin,
  Network,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Info,
  Users,
  UsersRound,
  X,
} from "lucide-react";
import { MemoryGraph } from "@/components/archive/MemoryGraph";
import { PhotoUpload } from "./PhotoUpload";
import { FamilyPanel } from "./FamilyPanel";
import { MomentPanel } from "./MomentPanel";
import { PeoplePanel } from "./PeoplePanel";
import { DeleteStory } from "./DeleteStory";
import { RecallSessions } from "./RecallSessions";
import { GraphQuestions } from "./GraphQuestions";
import { SidebarResizeHandle, SidebarToggle, useResizableSidebar } from "@/components/navigation/ResizableSidebar";
import { dateLabel, type CircleView } from "./types";
import "./circle.css";
const MemoryMap = dynamic(
  () => import("@/components/archive/MemoryMap").then((m) => m.MemoryMap),
  {
    ssr: false,
    loading: () => (
      <div className="circle-skeleton-map" role="status">
        Opening your places…
      </div>
    ),
  },
);
type Section = "moments" | "people" | "places" | "connections" | "stories" | "sessions";
const sectionNames: Record<Section, string> = { moments: "Moments", people: "People", places: "Places", connections: "Connections", stories: "Stories", sessions: "Recall sessions" };
export function CircleApp({ initialSection = "moments" }: { initialSection?: Section }) {
  const [data, setData] = useState<CircleView | null>(null),
    [error, setError] = useState(""),
    [section, setSection] = useState<Section>(initialSection),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState<"all" | "stories">("all"),
    [modal, setModal] = useState<"upload" | "sample" | "family" | null>(null),
    [momentId, setMomentId] = useState<string | null>(null),
    [photoId, setPhotoId] = useState<string | undefined>(),
    [toast, setToast] = useState("");
  const reduced = useReducedMotion();
  const sidebar = useResizableSidebar();
  const heading = useRef<HTMLHeadingElement>(null);
  const refresh = useCallback(async () => {
    const r = await fetch("/api/circle/state", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) {
      if (r.status === 401 || r.status === 403) setData(null);
      throw new Error(d.error || "Your collection could not be opened.");
    }
    setData(d);
    setError("");
  }, []);
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    const focus = () => void refresh().catch(() => {});
    const interval = setInterval(focus, data?.demo ? 3000 : 30000);
    window.addEventListener("focus", focus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", focus);
    };
  }, [refresh, data?.demo]);
  useEffect(() => {
    const update = () => {
      const h = location.hash.slice(1);
      if (Object.hasOwn(sectionNames, h))
        setSection(h as Section);
      else if (h === "topic-record") setSection("sessions");
      else if (h === "memories" || h === "suggestions") setSection("moments");
      else if (!h) setSection(initialSection);
    };
    update();
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("popstate", update);
    };
  }, [initialSection]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4200);
    return () => clearTimeout(timer);
  }, [toast]);
  const navigate = (s: Section) => {
    setSection(s);
    if (location.hash !== "#" + s) history.pushState(null, "", "#" + s);
    requestAnimationFrame(() => {
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView({ block: "start", behavior: "instant" });
    });
  };
  const moments =
    data?.moments.filter(
      (m) =>
        [
          m.title,
          m.place,
          ...m.people,
          ...data.stories.filter((s) => s.eventId === m.id).map((s) => s.text),
        ]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (filter === "all" || data.stories.some((s) => s.eventId === m.id)),
    ) || [];
  const openMoment = (id: string) => {
    setPhotoId(undefined);
    setMomentId(id);
    setModal(null);
  };
  return (
    <div className="circle-app" {...sidebar.layoutProps}>
      <a href="#circle-main" className="care-skip-link">
        Skip to content
      </a>
      <aside className="circle-rail" id="collection-sidebar">
        <div className="circle-rail-header">
        <Link
          className="circle-brand"
          aria-label="Recall home"
          href="/"
        >
          <RecallWordmark />
        </Link>
        <SidebarToggle sidebar={sidebar} controls="collection-sidebar" />
        </div>
        <div className="circle-family-badge">
          <span className="circle-family-symbol">
            {data?.personName[0] || "R"}
          </span>
          <div>
            <strong>
              {data?.personName || "Your family"}
              {data ? "’s circle" : ""}
            </strong>
            <span>A shared collection</span>
          </div>
        </div>
        <p className="circle-nav-label">YOUR CIRCLE</p>
        <nav aria-label="Your circle">
          {(
            [
              { id: "moments", name: "Moments", Icon: Images },
              { id: "people", name: "People", Icon: UsersRound },
              { id: "places", name: "Places", Icon: MapPin },
              { id: "connections", name: "Connections", Icon: Network },
              { id: "stories", name: "Stories", Icon: AudioLines },
              { id: "sessions", name: "Recall sessions", Icon: BookOpen },
            ] as const
          ).map(({ id, name, Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              aria-label={name}
              title={name}
              aria-current={section === id ? "page" : undefined}
              onClick={(event) => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                navigate(id);
              }}
            >
              <Icon size={19} />
              <span>{name}</span>
              {id === "moments" && data && <small>{data.moments.length}</small>}
              {section === id && (
                <motion.i
                  layoutId="circle-nav-active"
                  transition={{ type: "spring", stiffness: 350, damping: 32 }}
                />
              )}
            </a>
          ))}
          {data?.canManage && <Link href="/onboarding/manage" aria-label="Family settings" title="Family settings"><Settings size={19} aria-hidden="true" /><span>Family settings</span></Link>}
        </nav>
        <label className="circle-mobile-navigation">
          <span>In your circle</span>
          <select aria-label="Circle section" value={section} onChange={event => {
            if (event.target.value === "settings") window.location.assign("/onboarding/manage");
            else navigate(event.target.value as Section);
          }}>
            {Object.entries(sectionNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            {data?.canManage && <option value="settings">Family settings</option>}
          </select>
        </label>
        <div className="circle-rail-note">
          <BookOpen size={24} aria-hidden="true" />
          <p>
            The photographs
            <br />
            are just the beginning.
          </p>
          <span>Make room for the stories.</span>
        </div>
        <div className="circle-rail-bottom">
          <button className="circle-family-button" aria-label="Your family" title="Your family" onClick={() => setModal("family")}>
            <Users size={19} />
            <span>Your family</span>
            <Plus size={16} />
          </button>
          <div className="circle-user">
            <span className="circle-avatar">{data?.name[0] || "·"}</span>
            <div>
              <strong>{data?.name || "Opening your circle"}</strong>
              <span>{data?.demo ? "Sample family" : "Family contributor"}</span>
            </div>
            <i />
          </div>
        </div>
        <SidebarResizeHandle sidebar={sidebar} controls="collection-sidebar" />
      </aside>
      <div className="circle-workspace">
        <header className="circle-topbar">
          <Link className="circle-mobile-brand circle-entry-brand" href="/" aria-label="Recall home">
            <RecallWordmark />
          </Link>
          <span className="circle-breadcrumb">
            {data?.personName ? `${data.personName}’s circle` : "Your family"}
            <i>/</i>
            {sectionNames[section]}
          </span>
          <div>
            {data?.demo && (
              <span className="circle-demo-label">Sample family</span>
            )}
            <ShieldCheck size={15} />
            <span>Made for your family</span>
          </div>
        </header>
        <main id="circle-main" className="circle-main">
          {error ? (
            <div className="circle-empty">
              <h1>Let’s get you back in.</h1>
              <p>{error}</p>
              <button
                className="circle-button primary"
                onClick={() => void refresh().catch((e) => setError(e.message))}
              >
                Reconnect
                <ArrowRight size={18} />
              </button>
              <a className="circle-text-button" href="/onboarding">
                Continue family setup
              </a>
            </div>
          ) : !data ? (
            <div
              className="circle-loading"
              aria-label="Loading your collection"
            >
              <div />
              <div />
              <div />
            </div>
          ) : (
            <>
              <header className={`circle-heading${section === "sessions" ? " circle-sessions-heading" : ""}`}>
                <div>
                  <h1 ref={heading} tabIndex={-1}>
                    {section === "sessions" ? "Recall sessions." : section === "stories" ? "In your own words." : section === "moments"
                      ? "A life, in moments."
                      : section === "people"
                        ? "The people in your photographs."
                      : section === "places"
                        ? "The places that stay."
                        : "Everything is connected."}
                  </h1>
                  <p>
                    {section === "sessions" ? "Call history, topic by topic." : section === "stories" ? "Family stories, with the person who shared them." : section === "moments"
                      ? "You bring the photos. We find the moments."
                      : section === "people"
                        ? "Familiar faces, gathered together."
                      : section === "places"
                        ? "A familiar place. A hundred stories waiting."
                        : "People, places, and all the little things in between."}
                  </p>
                </div>
                {section !== "sessions" && <button
                  className="circle-button primary"
                  onClick={() => setModal("upload")}
                >
                  <Plus size={18} />
                  Add photos
                </button>}
              </header>
              {section === "sessions" ? <RecallSessions key={data.member} member={data.member} demo={data.demo} /> : section === "stories" ? <div className="circle-story-index">
                {data.stories.length ? [...data.stories].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(story => {
                  const moment = data.moments.find(m => m.id === story.eventId);
                  const photo = data.photos.find(p => p.id === moment?.coverId);
                  return <article key={story.id}>
                    {photo && <button className="circle-story-thumbnail" onClick={() => openMoment(story.eventId)} aria-label={`Open ${moment?.title}`}><img src={photo.url} alt={photo.caption || moment?.title || "Family photograph"} loading="lazy" /></button>}
                    <div><p className="circle-story-attribution">{story.author} · <time dateTime={story.createdAt}>{dateLabel(story.createdAt)}</time></p><blockquote>{story.text}</blockquote>{moment && <button className="circle-text-button" onClick={() => openMoment(moment.id)}>Open {moment.title}<ArrowRight size={16} aria-hidden="true" /></button>}{data.canManage && <DeleteStory story={story} onDeleted={async warning => { await refresh(); setToast(warning || "Story deleted."); }} />}</div>
                  </article>;
                }) : <div className="circle-record-empty"><p>No shared stories yet.</p><button className="circle-text-button" onClick={() => navigate("moments")}>Start with a moment<ArrowRight size={16} aria-hidden="true" /></button></div>}
              </div> : section === "people" ? <PeoplePanel key={data.photos.map(photo => photo.id).join("|")} data={data} onOpenPhoto={id => {
                const moment = data.moments.find(m => m.photoIds.includes(id));
                if (moment) { openMoment(moment.id); setPhotoId(id); }
              }} /> : data.moments.length === 0 ? (
                <section className="circle-first-moment">
                  <div className="circle-empty-collage" aria-hidden="true">
                    {[
                      "/sample-family/beach-01.jpg",
                      "/preview/princeton-garden.png",
                      "/preview/lincoln-library.png",
                    ].map((p, i) => (
                      <motion.img
                        key={p}
                        src={p}
                        initial={
                          reduced ? false : { opacity: 0, y: 40, rotate: 0 }
                        }
                        animate={{ opacity: 1, y: 0, rotate: (i - 1) * 12 }}
                        transition={{
                          duration: 0.8,
                          delay: i * 0.12,
                          ease: [0.16, 1, 0.3, 1],
                        }}
                      />
                    ))}
                    <span>
                      <Images size={20} aria-hidden="true" />
                    </span>
                  </div>
                  <h2>
                    A handful of photos.
                    <br />A whole world of stories.
                  </h2>
                  <p>
                    Drop in the camera roll. Recall brings related photos
                    together, finds the setting, and gives each moment a little
                    name.
                  </p>
                  <button
                    className="circle-button primary"
                    onClick={() => setModal("upload")}
                  >
                    <Camera size={18} />
                    Add your first photos
                    <ArrowRight size={18} />
                  </button>
                  {data.demo && (
                    <button
                      className="circle-text-button"
                      onClick={() => setModal("sample")}
                    >
                      Explore the sample photographs
                      <Images size={16} aria-hidden="true" />
                    </button>
                  )}
                  <div className="circle-how">
                    <span>
                      <span>01</span>Add photographs
                    </span>
                    <i />
                    <span>
                      <span>02</span>Discover moments
                    </span>
                    <i />
                    <span>
                      <span>03</span>Hear their stories
                    </span>
                  </div>
                </section>
              ) : (
                <AnimatePresence mode="wait">
                  <motion.div
                    key={section}
                    initial={reduced ? false : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.24 }}
                  >
                    {section === "moments" ? (
                      <>
                        <div className="circle-toolbar">
                          <div>
                            <button
                              className={filter === "all" ? "active" : ""}
                              onClick={() => setFilter("all")}
                            >
                              All moments<span>{data.moments.length}</span>
                            </button>
                            <button
                              className={filter === "stories" ? "active" : ""}
                              onClick={() => setFilter("stories")}
                            >
                              With a story
                              <span>
                                {
                                  new Set(data.stories.map((s) => s.eventId))
                                    .size
                                }
                              </span>
                            </button>
                          </div>
                          <label>
                            <Search size={17} />
                            <input
                              aria-label="Search your moments"
                              placeholder="A person, a place, a little detail…"
                              value={search}
                              onChange={(e) => setSearch(e.target.value)}
                            />
                            {search && (
                              <button
                                onClick={() => setSearch("")}
                                aria-label="Clear search"
                              >
                                <X size={15} />
                              </button>
                            )}
                          </label>
                        </div>
                        <div className="circle-moments-layout">
                          <div className="circle-grid">
                            {moments.map((m, i) => {
                              const cover = data.photos.find(
                                  (p) => p.id === m.coverId,
                                ),
                                story = data.stories.filter(
                                  (s) => s.eventId === m.id,
                                );
                              return (
                                <motion.button
                                  className="circle-moment-card"
                                  key={m.id}
                                  onClick={() => openMoment(m.id)}
                                  initial={
                                    reduced ? false : { opacity: 0, y: 20 }
                                  }
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{
                                    duration: 0.5,
                                    delay: Math.min(i, 5) * 0.06,
                                    ease: [0.16, 1, 0.3, 1],
                                  }}
                                  whileHover={reduced ? {} : { y: -5 }}
                                >
                                  <div className="circle-card-image">
                                    <img
                                      src={cover?.url}
                                      alt={cover?.caption || m.title}
                                      loading={i < 2 ? "eager" : "lazy"}
                                    />
                                    <span className="circle-photo-number">
                                      <Images size={14} />
                                      {m.photoIds.length} photos
                                    </span>
                                    <span className="circle-card-open">
                                      <ArrowRight size={21} />
                                    </span>
                                  </div>
                                  <div className="circle-card-body">
                                    <div className="circle-card-date">
                                      {dateLabel(m.startAt)}
                                      {m.titleSource === "ai" && (
                                        <Info
                                          size={14}
                                          aria-label="AI-organized moment"
                                        />
                                      )}
                                    </div>
                                    <h2>{m.title}</h2>
                                    <p className="circle-location">
                                      <MapPin size={14} />
                                      {m.place || "Somewhere worth remembering"}
                                    </p>
                                    <footer>
                                      <div className="circle-card-people">
                                        {m.people.length ? (
                                          <>
                                            <span className="circle-avatar-stack">
                                              {m.people.slice(0, 3).map((n) => (
                                                <i key={n}>{n[0]}</i>
                                              ))}
                                            </span>
                                            <span>
                                              {m.people.slice(0, 2).join(" & ")}
                                            </span>
                                          </>
                                        ) : (
                                          <span>
                                            {m.peopleCount
                                              ? `${m.peopleCount} people in the photographs`
                                              : story.length
                                                ? `A story from ${story[0]!.author}`
                                                : "A story waiting"}
                                          </span>
                                        )}
                                      </div>
                                      <span
                                        className={
                                          story.length
                                            ? "circle-story-indicator has-story"
                                            : "circle-story-indicator"
                                        }
                                      >
                                        {story.length ? (
                                          <>
                                            <Check size={13} />
                                            {story.length}{" "}
                                            {story.length === 1
                                              ? "story"
                                              : "stories"}
                                          </>
                                        ) : (
                                          <>＋ Add a story</>
                                        )}
                                      </span>
                                    </footer>
                                  </div>
                                </motion.button>
                              );
                            })}
                            {!moments.length && (
                              <div className="circle-empty-search">
                                <Search size={26} />
                                <h3>No moments found.</h3>
                                <p>A different word may bring it back.</p>
                                <button
                                  className="circle-text-button"
                                  onClick={() => {
                                    setSearch("");
                                    setFilter("all");
                                  }}
                                >
                                  Show all moments
                                </button>
                              </div>
                            )}
                            <button
                              className="circle-add-tile"
                              onClick={() => setModal("upload")}
                            >
                              <Plus size={28} />
                              <h3>There’s more to the story.</h3>
                              <p>Just add the photographs.</p>
                            </button>
                          </div>
                          <aside className="circle-story-sidebar">
                            <div className="circle-question-card">
                              <span>“</span>
                              <h3>
                                What’s outside the frame?
                              </h3>
                              <p>
                                The sounds. The inside joke.
                                <br />
                                The thing only you remember.
                              </p>
                              <button
                                className="circle-text-button"
                                onClick={() =>
                                  openMoment(
                                    data.moments.find(
                                      (m) =>
                                        !data.stories.some(
                                          (s) => s.eventId === m.id,
                                        ),
                                    )?.id || data.moments[0]!.id,
                                  )
                                }
                              >
                                Start with a moment
                                <ArrowRight size={16} />
                              </button>
                            </div>
                            <div className="circle-sidebar-family">
                              <p>A little closer, together.</p>
                              <div className="circle-avatar-stack">
                                {data.people.slice(0, 5).map((p, i) => (
                                  <i key={p.id} className={"tone-" + (i % 4)}>
                                    {p.name[0]}
                                  </i>
                                ))}
                              </div>
                              <p>
                                One shared collection.
                                <br />A different story from each of you.
                              </p>
                              <button
                                className="circle-text-button"
                                onClick={() => setModal("family")}
                              >
                                Invite your family
                                <ArrowRight size={15} />
                              </button>
                            </div>
                            <div className="circle-counts">
                              <div>
                                <strong>{data.photos.length}</strong>
                                <span>photos</span>
                              </div>
                              <div>
                                <strong>{data.moments.length}</strong>
                                <span>moments</span>
                              </div>
                              <div>
                                <strong>{data.stories.length}</strong>
                                <span>
                                  {data.stories.length === 1
                                    ? "story"
                                    : "stories"}
                                </span>
                              </div>
                            </div>
                          </aside>
                        </div>
                      </>
                    ) : section === "places" ? (
                      <MemoryMap
                        moments={data.moments}
                        photos={data.photos}
                        onSelect={(m) => openMoment(m.id)}
                      />
                    ) : (
                      <>
                      {data.people.find(person => person.id === data.member)?.role !== "participant" && <GraphQuestions key={data.member} revision={data.graphQueryRevision ?? JSON.stringify([data.moments, data.stories, data.connections])} onOpenMoment={openMoment} />}
                      <MemoryGraph
                        moments={data.moments}
                        photos={data.photos}
                        stories={data.stories}
                        connections={data.connections}
                        onSelect={(m) => openMoment(m.id)}
                      />
                      </>
                    )}
                  </motion.div>
                </AnimatePresence>
              )}
              <footer className="circle-page-footer">
                <span>Every photo, a beginning.</span>
                <span>Original stories. Always their own words.</span>
              </footer>
            </>
          )}
        </main>
      </div>
      <AnimatePresence>
        {modal === "upload" || modal === "sample" ? (
          <PhotoUpload
            key="upload"
            sample={modal === "sample"}
            demo={data?.demo ?? false}
            onClose={() => {
              setModal(null);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            onDone={async () => {
              await refresh();
              navigate("moments");
            }}
          />
        ) : modal === "family" && data ? (
          <FamilyPanel
            key="family"
            data={data}
            onClose={() => setModal(null)}
            onChanged={refresh}
          />
        ) : momentId && data?.moments.some((m) => m.id === momentId) ? (
          <MomentPanel
            key={momentId}
            id={momentId}
            initialPhotoId={photoId}
            data={data}
            onClose={() => setMomentId(null)}
            onChanged={refresh}
            onFamily={() => {
              setMomentId(null);
              setModal("family");
            }}
          />
        ) : null}
      </AnimatePresence>
      {toast && (
        <div className="circle-toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}
