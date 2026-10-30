import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "nemt og billigt",
  description: "nemtogbilligt.app — privat madplanlægger: billig mad efter danske tilbudsaviser.",
  robots: { index: false, follow: false },
  // "Føj til hjemmeskærm" on iPhone → opens full-screen like an app. No web
  // manifest on purpose: without one iOS saves the CURRENT url, and /plan keeps
  // the login in its #k= fragment, so the home-screen icon itself carries the
  // login — the app version never asks for the code (fragments never reach
  // the server or its logs).
  appleWebApp: { capable: true, title: "nemt og billigt", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf8f1" },
    { media: "(prefers-color-scheme: dark)", color: "#17181a" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="da">
      <body>{children}</body>
    </html>
  );
}
