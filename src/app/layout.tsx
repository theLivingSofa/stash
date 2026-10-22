import type { Metadata, Viewport } from "next";
import { Archivo, Source_Serif_4 } from "next/font/google";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ServiceWorker } from "@/components/ServiceWorker";
import "./globals.css";

// Archivo's width axis gives the mount-label voice (condensed caps) and the UI;
// Source Serif 4 with optical sizing carries the reading.
const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"], axes: ["wdth"], display: "swap" });
const sourceSerif = Source_Serif_4({ variable: "--font-source-serif", subsets: ["latin"], axes: ["opsz"], display: "swap" });

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
    { media: "(prefers-color-scheme: dark)", color: "#14110f" },
    { media: "(prefers-color-scheme: light)", color: "#e6ece7" },
  ],
};

// Applied before paint so the saved theme and font size never flash.
// Also: in an installed iPhone web app, iOS 26 can draw the page shorter than
// the screen (WebKit bugs 301994/316008) and keep the bottom strip, including
// the home bar, for itself. Pages can't draw there, so the nav must not add its
// own home-bar padding on top of that strip: set --safe-bottom to 0. Only for
// installed, full-width iPhone apps; Android and iPad split view are untouched.
const fitScript = `(function(){function fit(){try{var d=document.documentElement;if(navigator.standalone!==true){d.style.removeProperty("--safe-bottom");return;}var w=innerWidth,h=innerHeight,sw=screen.width,sh=screen.height,portrait=h>=w,full=portrait?Math.max(sw,sh):Math.min(sw,sh),fullW=portrait?Math.min(sw,sh):Math.max(sw,sh);if(Math.abs(w-fullW)<2&&full>h+20){d.style.setProperty("--safe-bottom","0px");}else{d.style.removeProperty("--safe-bottom");}}catch(e){}}fit();addEventListener("resize",fit);addEventListener("orientationchange",function(){setTimeout(fit,300);});})();`;

const settingsScript = `(function(){var d=document.documentElement;try{var s=JSON.parse(localStorage.getItem("stash-settings")||"{}");var t=s.v===2?s.theme:"auto";if(t!=="dark"&&t!=="light")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";d.dataset.theme=t;if(s.fontScale)d.style.setProperty("--font-scale",String(s.fontScale));}catch(e){d.dataset.theme="dark";}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="dark" className={`${archivo.variable} ${sourceSerif.variable}`} suppressHydrationWarning>
      <body>
        <Script id="stash-settings" strategy="beforeInteractive">
          {settingsScript + fitScript}
        </Script>
        {children}
        <ServiceWorker />
        {/* Vercel Web Analytics: cookieless page views (enabled on the Vercel project). */}
        <Analytics />
        {/* Vercel Speed Insights: real-device load and responsiveness metrics. */}
        <SpeedInsights />
      </body>
    </html>
  );
}
