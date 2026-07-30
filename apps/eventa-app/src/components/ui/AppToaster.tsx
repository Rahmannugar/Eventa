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
          toast: 'eventa-toast',
          success: 'eventa-toast eventa-toast--success',
          error: 'eventa-toast eventa-toast--error',
          warning: 'eventa-toast eventa-toast--warning',
          title: 'eventa-toast__title',
          description: 'eventa-toast__description',
          closeButton: 'eventa-toast__close',
        },
      }}
    />
  );
}
