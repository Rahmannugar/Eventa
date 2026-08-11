import { useParams } from 'react-router-dom';

import { EventEditor } from '../components/events/EventEditor';

export function AdminEventEditorPage() {
  const { eventId = '' } = useParams<{ eventId: string }>();
  return <EventEditor key={eventId} eventId={eventId} />;
}
