const SESSION_COOKIE_NAME = 'eventa_admin_session';

export interface AdminSessionCookieResponse {
  cookie(
    name: string,
    value: string,
    options: {
      expires: Date;
      httpOnly: boolean;
      path: string;
      sameSite: 'lax';
      secure: boolean;
    },
  ): void;
}

export class AdminSessionCookie {
  constructor(private readonly secure: boolean) {}

  set(
    response: AdminSessionCookieResponse,
    token: string,
    expiresAt: string,
  ): void {
    response.cookie(SESSION_COOKIE_NAME, token, {
      expires: new Date(expiresAt),
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: this.secure,
    });
  }
}
