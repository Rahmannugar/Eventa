import { useParams } from 'react-router-dom';

import { EventDetails } from '../components/events/EventDetails';

export function AdminEventDetailsPage() {
  const { eventId = '' } = useParams<{ eventId: string }>();
  return <EventDetails key={eventId} eventId={eventId} />;
}
