import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  activateAdmin,
  confirmAttendeeEmail,
  getCurrentAccount,
  login,
  logout,
  registerAttendee,
  requestAdminActivation,
  resendAttendeeEmail,
} from './auth.service';
import type {
  ActivateAdminInput,
  Actor,
  ConfirmAttendeeEmailInput,
  LoginInput,
  RegisterAttendeeInput,
  RequestAdminActivationInput,
  ResendAttendeeEmailInput,
  SessionAccount,
} from './auth.types';

export function sessionQueryKey(actor: Actor) {
  return ['authentication', actor, 'session'] as const;
}

export function useSession(actor: Actor) {
  return useQuery({
    queryFn: () => getCurrentAccount(actor),
    queryKey: sessionQueryKey(actor),
    retry: false,
    staleTime: 30_000,
  });
}

export function useLogin(actor: Actor) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: LoginInput) => login(actor, input),
    onSuccess: (account: SessionAccount) => {
      queryClient.setQueryData(sessionQueryKey(actor), account);
    },
  });
}

export function useLogout(actor: Actor) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => logout(actor),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: sessionQueryKey(actor) });
    },
  });
}

export function useRegisterAttendee() {
  return useMutation({
    mutationFn: (input: RegisterAttendeeInput) => registerAttendee(input),
  });
}

export function useConfirmAttendeeEmail() {
  return useMutation({
    mutationFn: (input: ConfirmAttendeeEmailInput) =>
      confirmAttendeeEmail(input),
  });
}

export function useResendAttendeeEmail() {
  return useMutation({
    mutationFn: (input: ResendAttendeeEmailInput) => resendAttendeeEmail(input),
  });
}

export function useRequestAdminActivation() {
  return useMutation({
    mutationFn: (input: RequestAdminActivationInput) =>
      requestAdminActivation(input),
  });
}

export function useActivateAdmin() {
  return useMutation({
    mutationFn: (input: ActivateAdminInput) => activateAdmin(input),
  });
}
