export {
  ADMIN_IDENTITY_SERVICE_NAME,
  AdminIdentityServiceControllerMethods,
  type AdminIdentityServiceClient,
  type AdminIdentityServiceController,
} from '../../generated/eventa/identity/v1/admin_identity_service.generated';
export type {
  RegisterAdminRequest,
  RegisterAdminResponse,
} from '../../generated/eventa/identity/v1/admin_registration.generated';
export type {
  ActivateAdminRequest,
  ActivateAdminResponse,
} from '../../generated/eventa/identity/v1/admin_activation.generated';
export type {
  LoginAdminRequest,
  LoginAdminResponse,
} from '../../generated/eventa/identity/v1/admin_login.generated';
export type {
  ForgotAdminPasswordRequest,
  ForgotAdminPasswordResponse,
  ResetAdminPasswordRequest,
  ResetAdminPasswordResponse,
} from '../../generated/eventa/identity/v1/admin_password_reset.generated';
export type {
  AuthenticateAdminSessionRequest,
  AuthenticateAdminSessionResponse,
  GetCurrentAdminAccountRequest,
  GetCurrentAdminAccountResponse,
  LogoutAdminRequest,
  LogoutAdminResponse,
} from '../../generated/eventa/identity/v1/admin_session.generated';
export {
  ATTENDEE_IDENTITY_SERVICE_NAME,
  AttendeeIdentityServiceControllerMethods,
  EVENTA_IDENTITY_V1_PACKAGE_NAME,
  type AttendeeIdentityServiceClient,
  type AttendeeIdentityServiceController,
} from '../../generated/eventa/identity/v1/attendee_identity_service.generated';
export type {
  ConfirmAttendeeEmailVerificationRequest,
  ConfirmAttendeeEmailVerificationResponse,
  ResendAttendeeEmailVerificationRequest,
  ResendAttendeeEmailVerificationResponse,
} from '../../generated/eventa/identity/v1/attendee_email_verification.generated';
export type {
  DeleteAttendeeAccountRequest,
  DeleteAttendeeAccountResponse,
} from '../../generated/eventa/identity/v1/attendee_deletion.generated';
export type {
  RegisterAttendeeRequest,
  RegisterAttendeeResponse,
} from '../../generated/eventa/identity/v1/attendee_registration.generated';
export type {
  LoginAttendeeRequest,
  LoginAttendeeResponse,
} from '../../generated/eventa/identity/v1/attendee_login.generated';
export type {
  ForgotAttendeePasswordRequest,
  ForgotAttendeePasswordResponse,
  ResetAttendeePasswordRequest,
  ResetAttendeePasswordResponse,
} from '../../generated/eventa/identity/v1/attendee_password_reset.generated';
export type {
  AuthenticateAttendeeSessionRequest,
  AuthenticateAttendeeSessionResponse,
  GetCurrentAttendeeAccountRequest,
  GetCurrentAttendeeAccountResponse,
  LogoutAttendeeRequest,
  LogoutAttendeeResponse,
} from '../../generated/eventa/identity/v1/attendee_session.generated';
export * from './proto-paths';
