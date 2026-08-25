# Commerce API

Commerce exposes authenticated order and payment operations through the API Gateway. It accepts one attendee-bound ticket purchase, records the selected ticket and quoted amount as an immutable order snapshot, and coordinates capacity reservation with Event Service. Payment provider updates establish payment state; client-side payment confirmation is not authoritative.
