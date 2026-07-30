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
    <section className="danger-zone" aria-labelledby="delete-account-title">
      <div>
        <h2 id="delete-account-title">Delete account</h2>
        <p>
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
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <section
            ref={dialogRef}
            className="confirmation-dialog"
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
              className="confirmation-dialog__close"
              aria-label="Close account deletion"
              disabled={deletion.isPending}
              onClick={close}
            >
              <XIcon aria-hidden="true" />
            </button>

            <h2 id="delete-dialog-title">Delete your account?</h2>
            <p id="delete-dialog-description">
              This closes your attendee account immediately. Enter your current
              password to confirm.
            </p>

            <form
              className="confirmation-dialog__form"
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
                <div className="form-alert" role="alert" aria-live="assertive">
                  {userFacingApiError(deletion.error)}
                </div>
              )}

              <div className="confirmation-dialog__actions">
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
