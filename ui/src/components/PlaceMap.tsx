import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { Area, Meal, PlaceCard } from "../../../shared/records";
import { SketchMap } from "./SketchMap";
import "./place-map.css";

export const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  label: string;
  kind: "base" | "anchor";
}

export interface PlaceMapProps {
  places: PlaceCard[];
  points?: MapPoint[];
  status?: Record<string, Meal["status"]>;
  selected?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
  /** Initial view when there is nothing to fit. */
  center?: { lat: number; lng: number };
  /** Area names, drawn only by the no-WebGL fallback. */
  areas?: Area[];
}

function hasWebGL2(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

/**
 * MapLibre map with our own pins: shape by kind (round books, square walks in), color by
 * kind, a dark ring with a check once the trip has a confirmed meal there.
 */
export function PlaceMap(props: PlaceMapProps) {
  const [gl] = useState(hasWebGL2);
  return gl ? <GLMap {...props} /> : <SketchMap {...props} />;
}

function GLMap({ places, points = [], status = {}, selected, onSelect, className, center }: PlaceMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new Map<string, maplibregl.Marker>());
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    if (!el.current) return;
    const m = new maplibregl.Map({
      container: el.current,
      style: MAP_STYLE,
      center: center ? [center.lng, center.lat] : [-77.04, -12.1],
      zoom: 11.2,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    m.touchZoomRotate.disableRotation();
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      markers.current.clear();
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const want = new Set<string>();
    const add = (key: string, lng: number, lat: number, build: () => HTMLElement, update: (e: HTMLElement) => void) => {
      want.add(key);
      let mk = markers.current.get(key);
      if (!mk) {
        mk = new maplibregl.Marker({ element: build(), anchor: "center" }).setLngLat([lng, lat]).addTo(m);
        markers.current.set(key, mk);
      } else mk.setLngLat([lng, lat]);
      update(mk.getElement());
    };
    for (const p of places) {
      if (p.lat === null || p.lng === null) continue;
      add(
        `p:${p.id}`,
        p.lng,
        p.lat,
        () => {
          const b = document.createElement("button");
          b.type = "button";
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            select.current?.(p.id);
          });
          return b;
        },
        (b) => {
          const st = status[p.id];
          b.className = ["pin", `pin-${p.kind ?? "none"}`, st && `pin-st-${st}`, selected === p.id && "pin-selected"].filter(Boolean).join(" ");
          b.setAttribute("aria-label", p.name);
          b.title = p.name;
          b.innerHTML = selected === p.id ? `<span class="pin-label">${escapeHtml(p.name)}</span>` : "";
        },
      );
    }
    for (const pt of points) {
      add(
        `x:${pt.kind}:${pt.id}`,
        pt.lng,
        pt.lat,
        () => document.createElement("div"),
        (d) => {
          d.className = `pin-point pin-point-${pt.kind}`;
          d.title = pt.label;
          d.innerHTML = `<span class="pin-label">${escapeHtml(pt.label)}</span>`;
        },
      );
    }
    for (const [k, mk] of markers.current) {
      if (!want.has(k)) {
        mk.remove();
        markers.current.delete(k);
      }
    }
  }, [places, points, status, selected]);

  const fitKey = places.map((p) => p.id).join(",") + points.map((p) => p.id).join(",");
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const coords = [...places.filter((p) => p.lat !== null && p.lng !== null).map((p) => [p.lng!, p.lat!] as [number, number]), ...points.map((p) => [p.lng, p.lat] as [number, number])];
    if (coords.length < 2) return;
    const b = coords.reduce((acc, c) => acc.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
    m.fitBounds(b, { padding: { top: 50, bottom: 60, left: 40, right: 40 }, maxZoom: 14.5, duration: 0 });
  }, [fitKey]);

  useEffect(() => {
    const m = map.current;
    const p = places.find((x) => x.id === selected);
    if (m && p?.lat != null && p.lng != null && !m.getBounds().contains([p.lng, p.lat])) m.easeTo({ center: [p.lng, p.lat], duration: 300 });
  }, [selected, places]);

  return <div ref={el} className={`place-map ${className ?? ""}`} />;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
