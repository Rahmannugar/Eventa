import { describe, expect, it } from 'vitest';

import { eventCancellationEmailTemplate } from '../../src/notifications/templates/cancellation/event-cancellation-email.template';

describe('eventCancellationEmailTemplate', () => {
  it('describes the cancelled event with its start time and venue', () => {
    const content = eventCancellationEmailTemplate({
      eventId: '2b4b5f8a-9d1e-4a3c-8a6f-1c2d3e4f5a6b',
      startsAt: '2026-10-12T18:00:00.000Z',
      timeZone: 'Europe/Lisbon',
      title: 'Riverlight Festival',
      venueCity: 'Lisbon',
      venueName: 'Parque das Nações',
    });

    expect(content.subject).toBe('Riverlight Festival has been cancelled');
    expect(content.text).toContain('Riverlight Festival');
    expect(content.text).toContain('Parque das Nações, Lisbon');
    expect(content.text).toContain(
      'Your tickets for this event are cancelled.',
    );
    expect(content.html).toContain('Parque das Nações, Lisbon');
  });

  it('omits the time and venue when the event summary has neither', () => {
    const content = eventCancellationEmailTemplate({
      eventId: '2b4b5f8a-9d1e-4a3c-8a6f-1c2d3e4f5a6b',
      title: 'Riverlight Festival',
    });

    expect(content.text).not.toContain('Parque das Nações');
    expect(content.html.match(/<p>/g)).toHaveLength(3);
    expect(content.text.split('\n').filter((line) => line !== '')).toHaveLength(
      4,
    );
  });

  it('escapes organizer-supplied event text in the HTML body', () => {
    const content = eventCancellationEmailTemplate({
      eventId: '2b4b5f8a-9d1e-4a3c-8a6f-1c2d3e4f5a6b',
      title: '<script>alert(1)</script>',
      venueName: 'Rock & Roll Hall',
      venueCity: "O'Hara",
    });

    expect(content.html).not.toContain('<script>');
    expect(content.html).toContain('&lt;script&gt;');
    expect(content.html).toContain('Rock &amp; Roll Hall');
    expect(content.html).toContain('O&#39;Hara');
    expect(content.subject).toBe(
      '<script>alert(1)</script> has been cancelled',
    );
  });
});
