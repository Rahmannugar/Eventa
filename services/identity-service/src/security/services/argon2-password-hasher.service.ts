import { argon2id, hash } from 'argon2';
import { runWithOperationSpan } from '@eventa/observability';

import type { PasswordHasher } from '../types/password-hasher.types';

export class Argon2PasswordHasher implements PasswordHasher {
  hash(password: string): Promise<string> {
    return runWithOperationSpan(
      'password.hash',
      () =>
        hash(password, {
          memoryCost: 65_536,
          parallelism: 4,
          timeCost: 3,
          type: argon2id,
        }),
      { attributes: { 'security.password.algorithm': 'argon2id' } },
    );
  }
}
