import { argon2id, hash, verify } from 'argon2';
import { runWithOperationSpan } from '@eventa/observability';

import type { PasswordHasher } from '../types/password-hasher.types';
import type { PasswordVerifier } from '../types/password-verifier.types';

export class Argon2PasswordHasher implements PasswordHasher, PasswordVerifier {
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

  verify(passwordHash: string, password: string): Promise<boolean> {
    return runWithOperationSpan(
      'password.verify',
      () => verify(passwordHash, password),
      { attributes: { 'security.password.algorithm': 'argon2id' } },
    );
  }
}
