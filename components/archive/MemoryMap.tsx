"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { ArrowUpRight, Crosshair, ImageIcon, MapPin, RotateCcw } from "lucide-react";
import type { Moment, Photo } from "@/lib/archive/types";
import "@/app/archive-visualizations.css";

type Props = { moments: Moment[]; photos: Photo[]; onSelect: (moment: Moment) => void };
function hasCoordinates(moment: Moment): moment is Moment & { latitude: number; longitude: number } {
  return typeof moment.latitude === "number" && typeof moment.longitude === "number" && Number.isFinite(moment.latitude) && Number.isFinite(moment.longitude) && Math.abs(moment.latitude) <= 85.051129 && Math.abs(moment.longitude) <= 180;
}

function PlacePhoto({ photo }: { photo?: Photo }) {
  const [failed, setFailed] = useState(false);
  return photo && !failed ? <img src={photo.url} alt="" loading="lazy" onError={() => setFailed(true)} /> : <span className="archive-atlas-photo-empty"><ImageIcon size={26} aria-hidden="true" /></span>;
}

export function MemoryMap({ moments, photos, onSelect }: Props) {
  const element = useRef<HTMLDivElement>(null), map = useRef<maplibregl.Map | null>(null);
  const select = useRef(onSelect), markers = useRef<Array<{ id: string; element: HTMLButtonElement }>>([]);
  const [mapError, setMapError] = useState(false), [mapLoading, setMapLoading] = useState(true), [selected, setSelected] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();
  const located = useMemo(() => moments.filter(hasCoordinates), [moments]);
  const fitAll = () => {
    if (!map.current || !element.current || !located.length) return;
    const bounds = new maplibregl.LngLatBounds();
    located.forEach((moment) => bounds.extend([moment.longitude, moment.latitude]));
    map.current.fitBounds(bounds, { padding: element.current.clientWidth < 600 ? { top: 190, bottom: 265, left: 65, right: 65 } : { top: 140, bottom: 245, left: 100, right: 100 }, maxZoom: 12, duration: 0 });
  };

  useEffect(() => { select.current = onSelect; }, [onSelect]);

  useEffect(() => {
    if (!element.current || !located.length) { setMapLoading(false); return; }
    let instance: maplibregl.Map | undefined;
    let observer: ResizeObserver | undefined;
    setMapError(false); setMapLoading(true);
    try {
      instance = new maplibregl.Map({
        container: element.current,
        style: { version: 8, sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors', maxzoom: 19 } }, layers: [{ id: "map", type: "raster", source: "osm", paint: { "raster-saturation": -.75, "raster-opacity": .85 } }] },
        center: [located[0]!.longitude, located[0]!.latitude], zoom: 5, attributionControl: false, scrollZoom: false,
      });
      map.current = instance;
      instance.getCanvas().setAttribute("aria-label", "Map of places named in your contributions");
      instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      instance.addControl(new maplibregl.AttributionControl({ compact: false }), "bottom-left");
      instance.on("error", () => { setMapError(true); setMapLoading(false); });
      instance.on("load", () => setMapLoading(false));
      observer = new ResizeObserver(() => instance?.resize());
      observer.observe(element.current);
      const counts = new Map<string, number>(), offsets = new Map<string, number>();
      located.forEach((moment) => { const key = `${moment.latitude},${moment.longitude}`; counts.set(key, (counts.get(key) ?? 0) + 1); });
      markers.current = [];
      located.forEach((moment) => {
        const key = `${moment.latitude},${moment.longitude}`, offset = offsets.get(key) ?? 0;
        offsets.set(key, offset + 1);
        const marker = document.createElement("button");
        marker.type = "button"; marker.className = "archive-photo-map-marker";
        marker.setAttribute("aria-label", `Open ${moment.title}${moment.place ? `, ${moment.place}` : ""}`);
        const photo = photos.find((item) => item.id === moment.coverId);
        if (photo) {
          const image = document.createElement("img"); image.src = photo.url; image.alt = "";
          image.addEventListener("error", () => { image.hidden = true; marker.classList.add("archive-marker-no-photo"); }, { once: true });
          marker.appendChild(image);
        } else marker.classList.add("archive-marker-no-photo");
        const label = document.createElement("span"); label.textContent = moment.title; marker.appendChild(label);
        marker.addEventListener("click", () => { setSelected(moment.id); select.current(moment); });
        new maplibregl.Marker({ element: marker, offset: [(offset - ((counts.get(key) ?? 1) - 1) / 2) * 58, 0] }).setLngLat([moment.longitude, moment.latitude]).addTo(instance!);
        markers.current.push({ id: moment.id, element: marker });
      });
      const bounds = new maplibregl.LngLatBounds();
      located.forEach((moment) => bounds.extend([moment.longitude, moment.latitude]));
      instance.fitBounds(bounds, { padding: element.current.clientWidth < 600 ? { top: 190, bottom: 265, left: 65, right: 65 } : { top: 140, bottom: 245, left: 100, right: 100 }, maxZoom: 12, duration: 0 });
    } catch { setMapError(true); setMapLoading(false); }
    return () => { observer?.disconnect(); instance?.remove(); map.current = null; markers.current = []; };
  }, [located, photos]);

  useEffect(() => { markers.current.forEach((marker) => { marker.element.dataset.selected = String(marker.id === selected); }); }, [selected]);

  const fly = (moment: Moment) => {
    setSelected(moment.id);
    if (hasCoordinates(moment) && map.current) map.current.flyTo({ center: [moment.longitude, moment.latitude], zoom: 11, duration: reduceMotion ? 0 : 1600, essential: false, padding: { top: 100, bottom: 230, left: 0, right: 0 } });
    else onSelect(moment);
  };

  return <section className="archive-atlas" aria-label="Places in your contributions">
    <div className="archive-atlas-map" ref={element} />
    <div className="archive-atlas-title"><h2>Somewhere worth remembering.</h2><p>Places you named in your memories.</p></div>
    {located.length > 0 && <button className="archive-atlas-reset" type="button" onClick={() => { setSelected(null); fitAll(); }} aria-label="Show all places on the map"><RotateCcw size={22} aria-hidden="true" /><span>All places</span></button>}
    {mapLoading && located.length > 0 && !mapError && <p className="archive-map-message" role="status">Opening the map…</p>}
    {mapError && <p className="archive-map-message" role="status">The base map is unavailable. You can still open your memories below.</p>}
    {!located.length && <div className="archive-atlas-empty"><MapPin size={32} aria-hidden="true" /><h3>{moments.length ? "No places pinned yet." : "Your places start with a memory."}</h3><p>{moments.length ? "Your memories are listed below. A named town or landmark can give them a place on the map." : "Places you add to your contributions will appear here."}</p></div>}
    {moments.length > 0 && <div className="archive-atlas-cards" role="list" aria-label="Memories by place">{moments.map((moment) => <article key={moment.id} role="listitem" className={`archive-atlas-card${selected === moment.id ? " is-selected" : ""}`}>
      <button type="button" className="archive-atlas-fly" onClick={() => fly(moment)} aria-label={hasCoordinates(moment) ? `Show ${moment.place || moment.title} on the map` : `Open ${moment.title}`}>
        <PlacePhoto photo={photos.find((photo) => photo.id === moment.coverId)} />
        <span><strong>{moment.place || "Place not added"}</strong><span className="archive-atlas-moment-title">{moment.title}</span></span>
      </button>
      <button type="button" className="archive-atlas-open" aria-label={`Open ${moment.title}`} onClick={() => onSelect(moment)}><ArrowUpRight size={24} aria-hidden="true" /></button>
    </article>)}</div>}
  </section>;
}

type PlacePickerProps = {
  latitude: number | null;
  longitude: number | null;
  onChange: (latitude: number, longitude: number) => void;
};

/** A place is chosen by the contributor, never read from their device location. */
export function PlacePicker({ latitude, longitude, onChange }: PlacePickerProps) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const callback = useRef(onChange);
  const initial = useRef({ latitude, longitude });
  const [error, setError] = useState(false), [ready, setReady] = useState(false);
  const hasSelection = latitude !== null && longitude !== null;

  useEffect(() => { callback.current = onChange; }, [onChange]);

  useEffect(() => {
    if (!container.current) return;
    let mapInstance: maplibregl.Map | undefined;
    let observer: ResizeObserver | undefined;
    try {
      const coordinates = initial.current;
      const selected = coordinates.latitude !== null && coordinates.longitude !== null;
      mapInstance = new maplibregl.Map({
        container: container.current,
        style: { version: 8, sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors', maxzoom: 19 } }, layers: [{ id: "map", type: "raster", source: "osm", paint: { "raster-saturation": -.75, "raster-opacity": .85 } }] },
        center: selected ? [coordinates.longitude!, coordinates.latitude!] : [0, 20], zoom: selected ? 10 : 2,
        attributionControl: false, scrollZoom: false,
      });
      instance.current = mapInstance;
      mapInstance.getCanvas().setAttribute("aria-label", "Choose a historical place. Arrow keys move the map; plus and minus change zoom.");
      mapInstance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      mapInstance.addControl(new maplibregl.AttributionControl({ compact: false }), "bottom-left");
      mapInstance.on("load", () => setReady(true));
      mapInstance.on("error", () => setError(true));
      mapInstance.on("click", (event) => callback.current(event.lngLat.lat, event.lngLat.wrap().lng));
      observer = new ResizeObserver(() => mapInstance?.resize());
      observer.observe(container.current);
    } catch { setError(true); }
    return () => { observer?.disconnect(); marker.current?.remove(); marker.current = null; mapInstance?.remove(); instance.current = null; };
  }, []);

  useEffect(() => {
    if (!instance.current || !container.current) return;
    if (latitude === null || longitude === null) { marker.current?.remove(); marker.current = null; return; }
    if (!marker.current) {
      marker.current = new maplibregl.Marker({ draggable: true, color: getComputedStyle(container.current).getPropertyValue("--recall-clay").trim() || "#98513f" }).setLngLat([longitude, latitude]).addTo(instance.current);
      marker.current.getElement().setAttribute("aria-label", "Selected place. Drag the pin, or move the map and use its center.");
      marker.current.on("dragend", () => {
        const point = marker.current?.getLngLat();
        if (point) callback.current(point.lat, point.wrap().lng);
      });
    } else marker.current.setLngLat([longitude, latitude]);
  }, [latitude, longitude, ready]);

  return <div className="archive-place-picker">
    <p>Choose the town or landmark you remember. Tap the map to place a pin, or drag the pin to adjust it.</p>
    <div className="archive-place-picker-view">
      <div ref={container} className="archive-place-picker-map" />
      <Crosshair className="archive-place-picker-crosshair" size={26} aria-hidden="true" />
      {error && <p className="archive-place-picker-error" role="status">The map couldn’t load. You can keep the place name and choose its position later.</p>}
    </div>
    <div className="archive-place-picker-actions">
      <button type="button" disabled={!ready || error} onClick={() => { const point = instance.current?.getCenter(); if (point) callback.current(point.lat, point.wrap().lng); }}><MapPin size={20} aria-hidden="true" />Use center of map</button>
      <p aria-live="polite">{hasSelection ? "Place selected." : "No place selected yet."}</p>
    </div>
  </div>;
}
