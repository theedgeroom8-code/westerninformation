import React from "react";
import { ScrollViewStyleReset } from "expo-router/html";

/** Custom HTML shell for the static web export (website / PWA). */
export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />
        <title>Edge System — Sports Betting Edge Tracker</title>
        <meta
          name="description"
          content="Real-time sports betting edge alerts with disciplined Kelly bet sizing and full P&L tracking. 21+ only. Not gambling advice."
        />
        <meta name="theme-color" content="#0f172a" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Edge System" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/pwa-icon.png" />
        <ScrollViewStyleReset />
        {/* Paint the app background before the JS bundle loads (no white flash) */}
        <style dangerouslySetInnerHTML={{ __html: "html,body{background:#0f172a}body{overscroll-behavior-y:none}" }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
