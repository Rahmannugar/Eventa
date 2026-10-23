import L from 'leaflet';
import markerIcon2xUrl from 'leaflet/dist/images/marker-icon-2x.png?url';
import markerIconUrl from 'leaflet/dist/images/marker-icon.png?url';
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png?url';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';

const venueIcon = L.icon({
  iconRetinaUrl: markerIcon2xUrl,
  iconUrl: markerIconUrl,
  shadowUrl: markerShadowUrl,
  iconAnchor: [12, 41],
  iconSize: [25, 41],
  shadowSize: [41, 41],
});

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const HOME_CENTER: L.LatLngExpression = [10, 5];
const HOME_ZOOM = 2;
const PIN_ZOOM = 14;

/* ESLint's base unused-vars rule does not distinguish TypeScript function parameters. */
/* eslint-disable no-unused-vars */
type VenuePick = (latitude: number, longitude: number) => void;
/* eslint-enable no-unused-vars */

interface VenuePoint {
  latitude: number | null;
  longitude: number | null;
}

function roundCoordinate(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

// EventVenueMap owns only the visual pin. The form stays the source of truth:
// every pick flows out through onPick as a pair, and typing a coordinate flows
// back in through point. OpenStreetMap tiles carry their attribution in the
// built-in control; no address lookup happens anywhere.
export function EventVenueMap({
  onPick,
  point,
}: {
  onPick: VenuePick;
  point: VenuePoint;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onPickRef = useRef(onPick);
  const mapOriginatedRef = useRef(false);

  useEffect(() => {
    onPickRef.current = onPick;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    const map = L.map(container, {
      attributionControl: true,
      center: HOME_CENTER,
      zoom: HOME_ZOOM,
    });
    L.tileLayer(TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(map);
    map.on('click', (event: L.LeafletMouseEvent) => {
      mapOriginatedRef.current = true;
      onPickRef.current(
        roundCoordinate(event.latlng.lat),
        roundCoordinate(event.latlng.lng),
      );
    });
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      mapOriginatedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null) return;

    const { latitude, longitude } = point;
    if (latitude === null || longitude === null) {
      markerRef.current?.remove();
      markerRef.current = null;
      mapOriginatedRef.current = false;
      return;
    }

    const latlng = L.latLng(latitude, longitude);
    const viewIsMine = mapOriginatedRef.current;
    mapOriginatedRef.current = false;

    const marker = markerRef.current;
    if (marker === null) {
      const created = L.marker(latlng, {
        alt: 'Venue location',
        draggable: true,
        icon: venueIcon,
      }).addTo(map);
      created.on('dragend', () => {
        mapOriginatedRef.current = true;
        const position = created.getLatLng();
        onPickRef.current(
          roundCoordinate(position.lat),
          roundCoordinate(position.lng),
        );
      });
      markerRef.current = created;
      if (!viewIsMine) map.setView(latlng, PIN_ZOOM);
      return;
    }

    marker.setLatLng(latlng);
    if (!viewIsMine && !map.getBounds().contains(latlng)) {
      map.setView(latlng, Math.max(map.getZoom(), PIN_ZOOM));
    }
  }, [point]);

  return <div className="size-full focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--focus)]" ref={containerRef} />;
}
