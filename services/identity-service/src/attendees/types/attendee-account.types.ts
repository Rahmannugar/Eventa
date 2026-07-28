export interface AttendeeAccount {
  attendeeId: string;
  email: string;
  emailVerified: true;
  status: 'active';
  username: string;
}

export interface AttendeeAccountRepository {
  findActiveAccount(attendeeId: string): Promise<AttendeeAccount | undefined>;
}
