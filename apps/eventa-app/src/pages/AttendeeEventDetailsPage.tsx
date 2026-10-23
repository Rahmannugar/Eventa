import { useParams } from 'react-router-dom';

import { AttendeeEventDetails } from '../components/attendee-events/AttendeeEventDetails';

export function AttendeeEventDetailsPage() {
  const { eventId } = useParams<{ eventId: string }>();
  return <AttendeeEventDetails eventId={eventId ?? ''} />;
}
