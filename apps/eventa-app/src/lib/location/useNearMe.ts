import { useCallback, useEffect, useRef, useState } from 'react';

export type NearMeState =
  | { status: 'active'; latitude: number; longitude: number }
  | { status: 'blocked' }
  | { status: 'idle' }
  | { status: 'locating' }
  | { status: 'unavailable' }
  | { status: 'unlocated' };

// useNearMe keeps the browser's answer on the client: the coordinates only
// ever travel as a search filter, and no location is stored anywhere.
export function useNearMe() {
  const [state, setState] = useState<NearMeState>({ status: 'idle' });
  const attemptRef = useRef(0);

  useEffect(
    () => () => {
      attemptRef.current += 1;
    },
    [],
  );

  const disable = useCallback(() => {
    attemptRef.current += 1;
    setState({ status: 'idle' });
  }, []);

  const enable = useCallback(() => {
    attemptRef.current += 1;
    const attempt = attemptRef.current;

    if (typeof navigator !== 'object' || !('geolocation' in navigator)) {
      setState({ status: 'unavailable' });
      return;
    }

    setState({ status: 'locating' });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (attempt !== attemptRef.current) return;
        const { latitude, longitude } = position.coords;
        if (Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
          setState({ latitude, longitude, status: 'active' });
        } else {
          setState({ status: 'unlocated' });
        }
      },
      (error) => {
        if (attempt !== attemptRef.current) return;
        setState({
          status:
            error.code === error.PERMISSION_DENIED
              ? 'blocked'
              : 'unavailable',
        });
      },
      { maximumAge: 300_000, timeout: 10_000 },
    );
  }, []);

  return { disable, enable, state };
}
