import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { darkColors, lightColors, AppColors } from '../theme';

export type ThemeMode = 'dark' | 'light' | 'auto';

const THEME_KEY = '@ai_mentor_theme';
const THEME_VERSION_KEY = '@ai_mentor_theme_v';
const THEME_VERSION = '3'; // bump to force reset to light default

interface ThemeContextType {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  colors: AppColors;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  themeMode: 'dark',
  setThemeMode: () => {},
  colors: darkColors,
  isDark: true,
});

// Auto mode: time-based — Light 6AM–6PM, Dark 6PM–6AM
function isNightTime(): boolean {
  const hour = new Date().getHours();
  return hour < 6 || hour >= 18;
}

function useSystemDark(): boolean {
  const [dark, setDark] = useState<boolean>(isNightTime);

  useEffect(() => {
    // Re-check every minute so it switches exactly at 6AM/6PM
    const interval = setInterval(() => setDark(isNightTime()), 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return dark;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemIsDark = useSystemDark();
  const [themeMode, setThemeModeState] = useState<ThemeMode>('dark');

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY).then((saved) => {
      if (saved === 'dark' || saved === 'light' || saved === 'auto') {
        setThemeModeState(saved);
      }
    }).catch(() => {});
  }, []);

  function setThemeMode(mode: ThemeMode) {
    setThemeModeState(mode);
    AsyncStorage.setItem(THEME_KEY, mode).catch(() => {});
  }

  const { colors, isDark } = useMemo(() => {
    const dark = themeMode === 'auto' ? systemIsDark : themeMode === 'dark';
    return { colors: dark ? darkColors : lightColors, isDark: dark };
  }, [themeMode, systemIsDark]);

  return (
    <ThemeContext.Provider value={{ themeMode, setThemeMode, colors, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
