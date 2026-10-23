import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { ProtectedSessionBoundary } from '../components/auth/SessionBoundary';
import { AttendeeShell } from '../components/attendee/AttendeeShell';
import { AdminDashboardShell } from '../components/events/AdminDashboardShell';
import { AdminActivationPage } from '../pages/AdminActivationPage';
import { AdminAnalyticsPage } from '../pages/AdminAnalyticsPage';
import { AdminEventCreatePage } from '../pages/AdminEventCreatePage';
import { AdminEventDetailsPage } from '../pages/AdminEventDetailsPage';
import { AdminEventEditorPage } from '../pages/AdminEventEditorPage';
import { AdminEventsPage } from '../pages/AdminEventsPage';
import { AttendeeAccountPage } from '../pages/AttendeeAccountPage';
import { AttendeeEmailVerificationPage } from '../pages/AttendeeEmailVerificationPage';
import { AttendeeEventDetailsPage } from '../pages/AttendeeEventDetailsPage';
import { AttendeeHomePage } from '../pages/AttendeeHomePage';
import { AttendeeRegistrationPage } from '../pages/AttendeeRegistrationPage';
import { AttendeeSearchPage } from '../pages/AttendeeSearchPage';
import { AttendeeTicketsPage } from '../pages/AttendeeTicketsPage';
import { LoginPage } from '../pages/LoginPage';
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage';
import { ResetPasswordPage } from '../pages/ResetPasswordPage';

const AttendeeCheckoutPage = lazy(() => import('../pages/AttendeeCheckoutPage').then((module) => ({ default: module.AttendeeCheckoutPage })));
const AttendeeCheckoutResultPage = lazy(() => import('../pages/AttendeeCheckoutResultPage').then((module) => ({ default: module.AttendeeCheckoutResultPage })));

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
        <Route element={<AttendeeShell />}>
          <Route path="/attendee" element={<AttendeeHomePage />} />
          <Route path="/attendee/search" element={<AttendeeSearchPage />} />
          <Route path="/attendee/events/:eventId" element={<AttendeeEventDetailsPage />} />
          <Route path="/attendee/events/:eventId/checkout" element={<Suspense fallback={<div role="status">Loading checkout…</div>}><AttendeeCheckoutPage /></Suspense>} />
          <Route path="/attendee/checkout/:orderId" element={<Suspense fallback={<div role="status">Loading booking…</div>}><AttendeeCheckoutResultPage /></Suspense>} />
          <Route path="/attendee/tickets" element={<AttendeeTicketsPage />} />
          <Route path="/attendee/account" element={<AttendeeAccountPage />} />
        </Route>
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
          <Route path="/admin/analytics" element={<AdminAnalyticsPage />} />
          <Route path="/admin/events/new" element={<AdminEventCreatePage />} />
          <Route
            path="/admin/events/:eventId"
            element={<AdminEventDetailsPage />}
          />
          <Route
            path="/admin/events/:eventId/edit"
            element={<AdminEventEditorPage />}
          />
        </Route>
      </Route>

      <Route path="*" element={<Navigate replace to="/attendee/login" />} />
    </Routes>
  );
}
