import { TrashIcon, XIcon } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { userFacingApiError } from '../../lib/api/api-error';
import { deleteAttendeeAccountSchema } from '../../lib/auth/auth.validation';
import { useDeleteAttendeeAccount } from '../../lib/auth/useAuth';
import { Button } from '../ui/Button';
import { PasswordField } from '../ui/PasswordField';

export function DeleteAttendeeAccount() {
  const navigate = useNavigate();
  const deletion = useDeleteAttendeeAccount();
  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const deletionPendingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string>();

  useEffect(() => {
    deletionPendingRef.current = deletion.isPending;
  }, [deletion.isPending]);

  useEffect(() => {
    if (!open) return;

    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    function keepFocusInside(event: KeyboardEvent) {
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );

      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable.at(-1);

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener('keydown', keepFocusInside);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', keepFocusInside);
      trigger?.focus();
    };
  }, [open]);

  function close() {
    if (deletion.isPending) return;
    setOpen(false);
    setPassword('');
    setPasswordError(undefined);
    deletion.reset();
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = deleteAttendeeAccountSchema.safeParse({ password });

    if (!result.success) {
      setPasswordError(
        result.error.issues[0]?.message ?? 'Enter your current password.',
      );
      return;
    }

    setPasswordError(undefined);

    try {
      await deletion.mutateAsync(result.data);
      toast.success('Account deleted');
      void navigate('/attendee/login', {
        replace: true,
        state: { accountDeleted: true },
      });
    } catch {
      // The normalized error remains visible inside the confirmation dialog.
    }
  }

  return (
    <section className="mt-4 flex flex-col items-start justify-between gap-6 rounded-2xl border border-red-700/25 bg-[var(--paper)] p-5 sm:flex-row sm:items-center" aria-labelledby="delete-account-title">
      <div>
        <h2 className="text-sm text-[var(--danger)]" id="delete-account-title">Delete account</h2>
        <p className="mt-1 max-w-[31rem] text-[13px] leading-relaxed text-[var(--muted)]">
          Permanently close this attendee account and end all of its sessions.
        </p>
      </div>
      <Button
        ref={triggerRef}
        type="button"
        variant="danger"
        onClick={() => {
          setOpen(true);
        }}
      >
        <TrashIcon aria-hidden="true" />
        Delete account
      </Button>

      {open ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#071f19]/60 p-4 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <section
            ref={dialogRef}
            className="relative w-full max-w-[29rem] rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-6 shadow-[0_24px_70px_rgb(7_31_25_/_25%)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
            aria-describedby="delete-dialog-description"
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !deletionPendingRef.current) close();
            }}
          >
            <button
              ref={closeButtonRef}
              type="button"
              className="absolute top-4 right-4 grid size-9 place-items-center rounded-[.6rem] text-[var(--muted)] hover:bg-[var(--soft)] hover:text-[var(--ink)] [&_svg]:size-4"
              aria-label="Close account deletion"
              disabled={deletion.isPending}
              onClick={close}
            >
              <XIcon aria-hidden="true" />
            </button>

            <h2 className="pr-10 font-[var(--serif)] text-[1.8rem] font-medium tracking-[-.04em]" id="delete-dialog-title">Delete your account?</h2>
            <p className="mt-3 text-[13px] leading-relaxed text-[var(--muted)]" id="delete-dialog-description">
              This closes your attendee account immediately. Enter your current
              password to confirm.
            </p>

            <form
              className="mt-5 grid gap-5"
              noValidate
              onSubmit={(event) => {
                void confirm(event);
              }}
            >
              <PasswordField
                id="delete-attendee-password"
                label="Current password"
                autoComplete="current-password"
                value={password}
                error={passwordError}
                onChange={(event) => {
                  setPassword(event.target.value);
                  deletion.reset();
                }}
              />

              {deletion.error === null ? null : (
                <div className="rounded-xl border border-[var(--danger)]/25 bg-[var(--danger-soft)] px-4 py-3 text-sm font-semibold leading-relaxed text-[var(--danger)]" role="alert" aria-live="assertive">
                  {userFacingApiError(deletion.error)}
                </div>
              )}

              <div className="flex justify-end gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={deletion.isPending}
                  onClick={close}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="danger"
                  busy={deletion.isPending}
                >
                  {deletion.isPending ? 'Deleting…' : 'Delete account'}
                </Button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}
