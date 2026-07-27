export interface PasswordVerifier {
  verify(passwordHash: string, password: string): Promise<boolean>;
}
