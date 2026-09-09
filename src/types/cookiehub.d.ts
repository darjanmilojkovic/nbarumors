/** The slice of the CookieHub API this site calls. */
interface CookieHub {
  openSettings: (tab?: string) => void;
  hasConsented: (category: string) => boolean;
}

interface Window {
  cookiehub?: CookieHub;
}
