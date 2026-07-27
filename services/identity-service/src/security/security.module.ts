import { Module } from '@nestjs/common';

import {
  PASSWORD_HASHER,
  PASSWORD_VERIFIER,
} from './constants/security.constants';
import { Argon2PasswordHasher } from './services/argon2-password-hasher.service';

@Module({
  providers: [
    Argon2PasswordHasher,
    {
      provide: PASSWORD_HASHER,
      useExisting: Argon2PasswordHasher,
    },
    {
      provide: PASSWORD_VERIFIER,
      useExisting: Argon2PasswordHasher,
    },
  ],
  exports: [PASSWORD_HASHER, PASSWORD_VERIFIER],
})
export class SecurityModule {}
