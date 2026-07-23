export interface RegisterAttendeeRequest {
  email: string;
  password: string;
  username: string;
}

export interface RegisterAttendeeResponse {
  attendeeId: string;
  email: string;
  username: string;
  emailVerified: boolean;
}
