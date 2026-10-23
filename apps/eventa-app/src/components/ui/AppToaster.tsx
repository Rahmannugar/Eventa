import {
  CheckCircleIcon,
  InfoIcon,
  WarningCircleIcon,
  XIcon,
} from '@phosphor-icons/react';
import { Toaster } from 'sonner';

export function AppToaster() {
  return (
    <Toaster
      closeButton
      duration={2600}
      gap={8}
      position="top-right"
      icons={{
        success: <CheckCircleIcon aria-hidden="true" weight="fill" />,
        info: <InfoIcon aria-hidden="true" weight="fill" />,
        warning: <WarningCircleIcon aria-hidden="true" weight="fill" />,
        error: <WarningCircleIcon aria-hidden="true" weight="fill" />,
        close: <XIcon aria-hidden="true" />,
      }}
      toastOptions={{
        classNames: {
          toast: '!rounded-xl !border !border-[var(--line)] !bg-[var(--paper)] !text-[var(--ink)] !shadow-xl',
          success: '!border-[#0b5945]/30 [&_[data-icon]]:text-[var(--evergreen)]',
          error: '!border-[var(--danger)]/30 !bg-[var(--danger-soft)] [&_[data-icon]]:text-[var(--danger)]',
          warning: '[&_[data-icon]]:text-amber-600',
          title: '!font-extrabold',
          description: '!text-[var(--muted)]',
          closeButton: '!border-[var(--line)] !bg-[var(--paper)] !text-[var(--muted)]',
        },
      }}
    />
  );
}
