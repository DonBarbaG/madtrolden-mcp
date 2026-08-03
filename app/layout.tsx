import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Madtrolden",
  description: "Privat MCP-server til billig madplanlægning efter danske tilbudsaviser.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="da">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#101312",
          color: "#e6e8e6",
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
        }}
      >
        {children}
      </body>
    </html>
  );
}
