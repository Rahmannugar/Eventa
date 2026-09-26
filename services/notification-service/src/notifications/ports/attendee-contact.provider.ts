export interface AttendeeContact {
  attendeeId: string;
  email: string;
}

export interface AttendeeContactProvider {
  getContact(attendeeId: string): Promise<AttendeeContact>;
}
