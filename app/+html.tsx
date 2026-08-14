import React from "react";
import { ScrollViewStyleReset } from "expo-router/html";

const SITE_URL = "https://westerninformation.vercel.app"; // swap for the custom domain when attached
const TITLE = "Western Information Network — Real-Time Sports Market Intelligence";
const DESCRIPTION =
  "Western Information Network delivers real-time sports market intelligence — pricing inefficiencies detected across global markets, disciplined Kelly-based position sizing, and complete performance tracking. NFL, NBA, WNBA, MLB, NHL, and college sports. For informational purposes only. 21+.";

/** Custom HTML shell for the static web export (website / PWA / SEO). */
export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />
        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <link rel="canonical" href={SITE_URL} />
        <meta name="robots" content="index, follow" />
        <meta name="theme-color" content="#0a0a0c" />

        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Western Information Network" />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={DESCRIPTION} />
        <meta property="og:url" content={SITE_URL} />
        <meta property="og:image" content={`${SITE_URL}/og.png`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />

        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={TITLE} />
        <meta name="twitter:description" content={DESCRIPTION} />
        <meta name="twitter:image" content={`${SITE_URL}/og.png`} />

        {/* PWA / icons */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="WIN Network" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/pwa-icon.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
        <link rel="icon" type="image/png" sizes="1024x1024" href="/pwa-icon.png" />

        <ScrollViewStyleReset />
        {/* Paint the app background before the JS bundle loads (no white flash) */}
        <style dangerouslySetInnerHTML={{ __html: "html,body{background:#0f172a}body{overscroll-behavior-y:none}" }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
