import { Module } from '@nestjs/common';

import { PASSWORD_HASHER } from './constants/security.constants';
import { Argon2PasswordHasher } from './services/argon2-password-hasher.service';

@Module({
  providers: [
    {
      provide: PASSWORD_HASHER,
      useClass: Argon2PasswordHasher,
    },
  ],
  exports: [PASSWORD_HASHER],
})
export class SecurityModule {}
