const SESSION_COOKIE_NAME = 'eventa_attendee_session';
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface AttendeeCookieResponse {
  clearCookie(
    name: string,
    options: {
      httpOnly: boolean;
      path: string;
      sameSite: 'lax';
      secure: boolean;
    },
  ): void;
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

export class AttendeeSessionCookie {
  constructor(private readonly secure: boolean) {}

  read(cookieHeader: string | undefined): string | undefined {
    if (cookieHeader === undefined) {
      return undefined;
    }

    const values = cookieHeader
      .split(';')
      .map((entry) => entry.trim())
      .filter((entry) => entry.startsWith(`${SESSION_COOKIE_NAME}=`))
      .map((entry) => entry.slice(SESSION_COOKIE_NAME.length + 1));

    if (values.length !== 1 || !SESSION_TOKEN_PATTERN.test(values[0] ?? '')) {
      return undefined;
    }

    return values[0];
  }

  set(
    response: AttendeeCookieResponse,
    token: string,
    expiresAt: string,
  ): void {
    response.cookie(SESSION_COOKIE_NAME, token, {
      expires: new Date(expiresAt),
      ...this.options(),
    });
  }

  clear(response: AttendeeCookieResponse): void {
    response.clearCookie(SESSION_COOKIE_NAME, this.options());
  }

  private options() {
    return {
      httpOnly: true,
      path: '/',
      sameSite: 'lax' as const,
      secure: this.secure,
    };
  }
}
