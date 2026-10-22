import type { Metadata, Viewport } from "next";
import { Literata, Schibsted_Grotesk } from "next/font/google";
import Script from "next/script";
import { ServiceWorker } from "@/components/ServiceWorker";
import "./globals.css";

const literata = Literata({ variable: "--font-literata", subsets: ["latin"], axes: ["opsz"], display: "swap" });
const schibsted = Schibsted_Grotesk({ variable: "--font-schibsted", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Stash",
  description: "An endless feed of ideas worth keeping.",
  manifest: "/manifest.webmanifest",
  applicationName: "Stash",
  appleWebApp: { capable: true, title: "Stash", statusBarStyle: "black-translucent" },
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/favicon-48.png", sizes: "48x48", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#111a2c" },
    { media: "(prefers-color-scheme: light)", color: "#e9edf4" },
  ],
};

// Applied before paint so the saved theme and font size never flash.
// Also: in an installed iPhone web app, iOS 26 can report a viewport shorter
// than the screen (by about the status-bar height) while drawing the page from
// the very top, leaving an empty band under the bottom nav. When that happens,
// size the app frame to the real screen height. iPhone-only (navigator.standalone),
// full-width windows only, so Android and iPad split view are untouched.
const fitScript = `(function(){function fit(){try{var d=document.documentElement;if(navigator.standalone!==true){d.style.removeProperty("--app-h");return;}var w=innerWidth,h=innerHeight,sw=screen.width,sh=screen.height,portrait=h>=w,full=portrait?Math.max(sw,sh):Math.min(sw,sh),fullW=portrait?Math.min(sw,sh):Math.max(sw,sh);if(Math.abs(w-fullW)<2&&full>h+1){d.style.setProperty("--app-h",full+"px");}else{d.style.removeProperty("--app-h");}}catch(e){}}fit();addEventListener("resize",fit);addEventListener("orientationchange",function(){setTimeout(fit,300);});})();`;

const settingsScript = `(function(){try{var s=JSON.parse(localStorage.getItem("stash-settings")||"{}");var d=document.documentElement;d.dataset.theme=s.theme==="light"?"light":"dark";if(s.fontScale)d.style.setProperty("--font-scale",String(s.fontScale));}catch(e){document.documentElement.dataset.theme="dark";}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="dark" className={`${literata.variable} ${schibsted.variable}`} suppressHydrationWarning>
      <body>
        <Script id="stash-settings" strategy="beforeInteractive">
          {settingsScript + fitScript}
        </Script>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
