import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mixer — make friends, find your group",
  description:
    "Mixer matches you with compatible strangers for dinners and activities, then helps you turn the best tables into lasting friend groups.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#7c5cfc",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-frame">{children}</div>
      </body>
    </html>
  );
}
