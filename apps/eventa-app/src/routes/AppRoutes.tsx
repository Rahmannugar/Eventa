import { Navigate, Route, Routes } from 'react-router-dom';

import { ProtectedSessionBoundary } from '../components/auth/SessionBoundary';
import { AdminDashboardShell } from '../components/events/AdminDashboardShell';
import { AccountPage } from '../pages/AccountPage';
import { AdminActivationPage } from '../pages/AdminActivationPage';
import { AdminEventCreatePage } from '../pages/AdminEventCreatePage';
import { AdminEventEditorPage } from '../pages/AdminEventEditorPage';
import { AdminEventsPage } from '../pages/AdminEventsPage';
import { AttendeeEmailVerificationPage } from '../pages/AttendeeEmailVerificationPage';
import { AttendeeRegistrationPage } from '../pages/AttendeeRegistrationPage';
import { LoginPage } from '../pages/LoginPage';
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage';
import { ResetPasswordPage } from '../pages/ResetPasswordPage';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate replace to="/attendee/login" />} />

      <Route path="/attendee/login" element={<LoginPage actor="attendee" />} />
      <Route
        path="/attendee/forgot-password"
        element={<ForgotPasswordPage actor="attendee" />}
      />
      <Route
        path="/attendee/reset-password"
        element={<ResetPasswordPage actor="attendee" />}
      />
      <Route path="/attendee/register" element={<AttendeeRegistrationPage />} />
      <Route
        path="/attendee/verify-email"
        element={<AttendeeEmailVerificationPage />}
      />
      <Route element={<ProtectedSessionBoundary actor="attendee" />}>
        <Route path="/attendee" element={<AccountPage actor="attendee" />} />
      </Route>

      <Route path="/admin/login" element={<LoginPage actor="admin" />} />
      <Route
        path="/admin/forgot-password"
        element={<ForgotPasswordPage actor="admin" />}
      />
      <Route
        path="/admin/reset-password"
        element={<ResetPasswordPage actor="admin" />}
      />
      <Route path="/admin/activate" element={<AdminActivationPage />} />
      <Route element={<ProtectedSessionBoundary actor="admin" />}>
        <Route element={<AdminDashboardShell />}>
          <Route path="/admin" element={<AdminEventsPage />} />
          <Route path="/admin/events/new" element={<AdminEventCreatePage />} />
          <Route
            path="/admin/events/:eventId"
            element={<AdminEventEditorPage />}
          />
        </Route>
      </Route>

      <Route path="*" element={<Navigate replace to="/attendee/login" />} />
    </Routes>
  );
}
