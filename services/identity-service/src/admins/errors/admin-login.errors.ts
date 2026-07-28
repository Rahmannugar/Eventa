export class InvalidAdminCredentialsError extends Error {
  constructor() {
    super('INVALID_ADMIN_CREDENTIALS');
    this.name = InvalidAdminCredentialsError.name;
  }
}
