import L from 'leaflet';
import markerIcon2xUrl from 'leaflet/dist/images/marker-icon-2x.png?url';
import markerIconUrl from 'leaflet/dist/images/marker-icon.png?url';
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png?url';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

export interface MappedEvent {
  eventId: string;
  title: string;
  latitude: number;
  longitude: number;
  place?: string | undefined;
}

const markerIcon = L.icon({
  iconRetinaUrl: markerIcon2xUrl,
  iconUrl: markerIconUrl,
  shadowUrl: markerShadowUrl,
  iconAnchor: [12, 41],
  iconSize: [25, 41],
  shadowSize: [41, 41],
});

export function EventLocationsMap({ events, label }: { events: MappedEvent[]; label: string }) {
  const container = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (container.current === null || events.length === 0) return;
    const map = L.map(container.current, { scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    const bounds = L.latLngBounds([]);
    for (const event of events) {
      const point = L.latLng(event.latitude, event.longitude);
      bounds.extend(point);
      const link = document.createElement('a');
      link.href = `/attendee/events/${encodeURIComponent(event.eventId)}`;
      link.textContent = event.title;
      link.className = 'font-semibold text-[#0b5945] underline';
      link.addEventListener('click', (click) => {
        click.preventDefault();
        void navigate(link.pathname);
      });
      const popup = document.createElement('div');
      popup.append(link);
      if (event.place) {
        const place = document.createElement('p');
        place.textContent = event.place;
        place.className = 'mt-1 text-xs';
        popup.append(place);
      }
      L.marker(point, { alt: event.title, icon: markerIcon }).addTo(map).bindPopup(popup);
    }
    if (events.length === 1) map.setView(bounds.getCenter(), 12);
    else map.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
    const frame = requestAnimationFrame(() => map.invalidateSize());
    return () => {
      cancelAnimationFrame(frame);
      map.remove();
    };
  }, [events, navigate]);

  if (events.length === 0) return <p className="rounded-xl border border-[var(--line)] bg-[var(--paper)] p-5 text-sm text-[var(--muted)]">These events do not have map locations yet.</p>;
  return <div aria-label={label} className="h-[min(55vh,440px)] min-h-72 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--soft)] [&_.leaflet-container]:size-full [&_.leaflet-control-attribution]:text-[10px]" ref={container} role="region" />;
}
