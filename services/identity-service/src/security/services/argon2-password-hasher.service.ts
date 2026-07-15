import { argon2id, hash } from 'argon2';

import type { PasswordHasher } from '../types/password-hasher.types';

export class Argon2PasswordHasher implements PasswordHasher {
  hash(password: string): Promise<string> {
    return hash(password, { type: argon2id });
  }
}
