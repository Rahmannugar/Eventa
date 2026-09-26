import type { EventSummary } from '../../ports/event-summary.provider';

export interface EventCancellationEmailContent {
  html: string;
  subject: string;
  text: string;
}

export function eventCancellationEmailTemplate(
  summary: EventSummary,
): EventCancellationEmailContent {
  const opening = `We're sorry to let you know that ${summary.title} has been cancelled.`;
  const when = formatStartsAt(summary.startsAt, summary.timeZone);
  const place = formatVenue(summary.venueName, summary.venueCity);
  const meaning = 'Your tickets for this event are cancelled.';
  const nextStep = 'There is nothing you need to do.';

  const textLines = [
    opening,
    ...(when === undefined ? [] : ['', when]),
    ...(place === undefined ? [] : ['', place]),
    '',
    meaning,
    nextStep,
    '',
    'Eventa',
  ];

  const detailParagraphs = [
    ...(when === undefined ? [] : [`<p>${escapeHtml(when)}</p>`]),
    ...(place === undefined ? [] : [`<p>${escapeHtml(place)}</p>`]),
  ];

  const html = [
    `<p>${escapeHtml(opening)}</p>`,
    ...detailParagraphs,
    `<p>${escapeHtml(meaning)} ${escapeHtml(nextStep)}</p>`,
    '<p>Eventa</p>',
  ].join('');

  return {
    html,
    subject: `${summary.title} has been cancelled`,
    text: textLines.join('\n'),
  };
}

function formatStartsAt(
  startsAt: string | undefined,
  timeZone: string | undefined,
): string | undefined {
  if (startsAt === undefined) {
    return undefined;
  }

  const timestamp = new Date(startsAt);

  if (Number.isNaN(timestamp.getTime())) {
    return undefined;
  }

  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'long',
    ...(timeZone === undefined
      ? {}
      : { timeZone, timeZoneName: 'short' as const }),
    weekday: 'long',
    year: 'numeric',
  }).format(timestamp);
}

function formatVenue(
  venueName: string | undefined,
  venueCity: string | undefined,
): string | undefined {
  const parts = [venueName, venueCity].filter(
    (part): part is string => part !== undefined && part.length > 0,
  );

  return parts.length === 0 ? undefined : parts.join(', ');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
