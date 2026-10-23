import { useEffect, useState } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';

const storageKey = 'eventa.theme';

function storedTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(storageKey);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeChoice>(storedTheme);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && media.matches));
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  function chooseTheme(choice: ThemeChoice) {
    try {
      if (choice === 'system') localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, choice);
    } catch {
      // The choice still applies for this visit when storage is unavailable.
    }
    setTheme(choice);
  }

  return { theme, chooseTheme };
}
