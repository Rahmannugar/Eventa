import { Navigate, Route, Routes } from 'react-router-dom';

import { ProtectedSessionBoundary } from '../components/auth/SessionBoundary';
import { AccountPage } from '../pages/AccountPage';
import { AdminActivationPage } from '../pages/AdminActivationPage';
import { AttendeeEmailVerificationPage } from '../pages/AttendeeEmailVerificationPage';
import { AttendeeRegistrationPage } from '../pages/AttendeeRegistrationPage';
import { LoginPage } from '../pages/LoginPage';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate replace to="/attendee/login" />} />

      <Route path="/attendee/login" element={<LoginPage actor="attendee" />} />
      <Route path="/attendee/register" element={<AttendeeRegistrationPage />} />
      <Route
        path="/attendee/verify-email"
        element={<AttendeeEmailVerificationPage />}
      />
      <Route element={<ProtectedSessionBoundary actor="attendee" />}>
        <Route path="/attendee" element={<AccountPage actor="attendee" />} />
      </Route>

      <Route path="/admin/login" element={<LoginPage actor="admin" />} />
      <Route path="/admin/activate" element={<AdminActivationPage />} />
      <Route element={<ProtectedSessionBoundary actor="admin" />}>
        <Route path="/admin" element={<AccountPage actor="admin" />} />
      </Route>

      <Route path="*" element={<Navigate replace to="/attendee/login" />} />
    </Routes>
  );
}
