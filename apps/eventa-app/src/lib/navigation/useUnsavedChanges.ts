import { useEffect } from 'react';

export function useUnsavedChanges(active: boolean, message: string): void {
  useEffect(() => {
    if (!active) return;

    const preventBrowserExit = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const protectLinkNavigation = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target;
      const navigationTarget =
        target instanceof Element
          ? target.closest<HTMLElement>('a[href], [data-navigation]')
          : null;
      if (
        navigationTarget === null ||
        (navigationTarget instanceof HTMLAnchorElement &&
          (navigationTarget.target === '_blank' ||
            navigationTarget.hasAttribute('download')))
      ) {
        return;
      }
      if (navigationTarget instanceof HTMLAnchorElement) {
        const destination = new URL(
          navigationTarget.href,
          window.location.href,
        );
        if (
          destination.origin !== window.location.origin ||
          destination.href === window.location.href
        ) {
          return;
        }
      }
      if (window.confirm(message)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener('beforeunload', preventBrowserExit);
    document.addEventListener('click', protectLinkNavigation, true);
    return () => {
      window.removeEventListener('beforeunload', preventBrowserExit);
      document.removeEventListener('click', protectLinkNavigation, true);
    };
  }, [active, message]);
}
