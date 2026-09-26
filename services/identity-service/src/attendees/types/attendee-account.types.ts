export interface AttendeeAccount {
  attendeeId: string;
  email: string;
  emailVerified: true;
  status: 'active';
  username: string;
}

export interface AttendeeContact {
  attendeeId: string;
  email: string;
}

export interface AttendeeAccountRepository {
  findActiveAccount(attendeeId: string): Promise<AttendeeAccount | undefined>;
  findContactEmail(attendeeId: string): Promise<AttendeeContact | undefined>;
}
