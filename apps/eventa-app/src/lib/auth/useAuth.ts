import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getCurrentAccount, login, logout } from './auth.service';
import type { Actor, LoginInput, SessionAccount } from './auth.types';

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
