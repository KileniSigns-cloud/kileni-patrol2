import { createContext, useContext, useEffect, useState } from 'react';

/** 'light' / 'dark' when the user picked one with the header toggle; null = follow the system. */
type ThemeChoice = 'light' | 'dark' | null;

interface ThemeContextType {
  isDark: boolean;
  toggle: () => void;
}

// A new key: the old 'theme' key was written on every load, so it never reflected a choice.
const STORAGE_KEY = 'patrol-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null; // storage blocked (private mode): follow the system
  }
}

function saveChoice(choice: ThemeChoice) {
  try {
    if (choice) localStorage.setItem(STORAGE_KEY, choice);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage blocked: the choice lasts for this visit only
  }
}

const systemDark = () => typeof window !== 'undefined' && window.matchMedia?.(DARK_QUERY).matches === true;

const ThemeContext = createContext<ThemeContextType>({ isDark: false, toggle: () => {} });

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [choice, setChoice] = useState<ThemeChoice>(readChoice);
  const [sysDark, setSysDark] = useState(systemDark);

  useEffect(() => {
    const mq = window.matchMedia?.(DARK_QUERY);
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setSysDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // The CSS tokens read data-theme; without it they follow prefers-color-scheme.
  useEffect(() => {
    const root = document.documentElement;
    if (choice) root.setAttribute('data-theme', choice);
    else root.removeAttribute('data-theme');
  }, [choice]);

  const isDark = choice ? choice === 'dark' : sysDark;

  const toggle = () => {
    const next: ThemeChoice = isDark ? 'light' : 'dark';
    setChoice(next);
    saveChoice(next);
  };

  return <ThemeContext.Provider value={{ isDark, toggle }}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => useContext(ThemeContext);
