import { useEffect, useRef, useState } from "react";
import type { Area } from "../../../shared/records";
import type { MapPoint, PlaceMapProps } from "./PlaceMap";

/**
 * Drawn stand-in for PlaceMap where WebGL2 is unavailable (old phones, locked-down browsers):
 * the same pins at their projected positions over area names, without tiles.
 */
export function SketchMap({ places, points = [], status = {}, selected, onSelect, className, areas = [] }: PlaceMapProps & { areas?: Area[] }) {
  const el = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 360, h: 400 });
  useEffect(() => {
    if (!el.current) return;
    const ro = new ResizeObserver(([e]) => e && setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el.current);
    return () => ro.disconnect();
  }, []);

  const pts = [...places.filter((p) => p.lat !== null && p.lng !== null).map((p) => ({ lat: p.lat!, lng: p.lng! })), ...points];
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  const minLat = Math.min(...lats, -12.16);
  const maxLat = Math.max(...lats, -12.04);
  const minLng = Math.min(...lngs, -77.06);
  const maxLng = Math.max(...lngs, -77.0);
  const cos = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const pad = 36;
  const spanX = (maxLng - minLng) * cos || 0.01;
  const spanY = maxLat - minLat || 0.01;
  // Extra room at the bottom for the selected-place card that overlays the map.
  const padBottom = 120;
  const k = Math.min((size.w - pad * 2) / spanX, (size.h - pad - padBottom) / spanY);
  const ox = (size.w - spanX * k) / 2;
  const oy = pad + (size.h - pad - padBottom - spanY * k) / 2;
  const at = (lat: number, lng: number) => ({ left: ox + (lng - minLng) * cos * k, top: oy + (maxLat - lat) * k });

  return (
    <div ref={el} className={`place-map sketch-map ${className ?? ""}`}>
      {areas
        .filter((a) => a.lat !== null && a.lng !== null)
        .map((a) => (
          <span key={a.id} className="sketch-area" style={at(a.lat!, a.lng!)}>
            {a.name}
          </span>
        ))}
      {points.map((p: MapPoint) => (
        <div key={p.id} className={`pin-point pin-point-${p.kind} sketch-pin`} style={at(p.lat, p.lng)} title={p.label}>
          <span className="pin-label">{p.label}</span>
        </div>
      ))}
      {places
        .filter((p) => p.lat !== null && p.lng !== null)
        .map((p) => {
          const st = status[p.id];
          return (
            <button
              key={p.id}
              type="button"
              aria-label={p.name}
              title={p.name}
              className={["pin", "sketch-pin", `pin-${p.kind ?? "none"}`, st && `pin-st-${st}`, selected === p.id && "pin-selected"].filter(Boolean).join(" ")}
              style={at(p.lat!, p.lng!)}
              onClick={() => onSelect?.(p.id)}
            >
              {selected === p.id && <span className="pin-label">{p.name}</span>}
            </button>
          );
        })}
      <span className="sketch-note">Simplified map</span>
    </div>
  );
}
