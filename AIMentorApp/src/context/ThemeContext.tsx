import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { useColorScheme } from 'react-native';
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

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
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
    let isDark = true;
    if (themeMode === 'auto') {
      isDark = systemScheme !== 'light';
    } else {
      isDark = themeMode === 'dark';
    }
    return { colors: isDark ? darkColors : lightColors, isDark };
  }, [themeMode, systemScheme]);

  return (
    <ThemeContext.Provider value={{ themeMode, setThemeMode, colors, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
