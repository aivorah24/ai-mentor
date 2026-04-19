import { useWindowDimensions } from 'react-native';

export type ScreenSize = 'mobile' | 'tablet' | 'desktop';

export function useResponsive() {
  const { width, height } = useWindowDimensions();

  const isMobile = width < 768;
  const isTablet = width >= 768 && width < 1024;
  const isDesktop = width >= 1024;

  const screenSize: ScreenSize = isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop';

  // Sidebar is always visible on tablet/desktop
  const showPermanentSidebar = !isMobile;

  return {
    width,
    height,
    isMobile,
    isTablet,
    isDesktop,
    screenSize,
    showPermanentSidebar,
  };
}
