/** The root layout: fonts, theme, and the shell around every page. */

import { MotionProvider } from "@/components/motion-provider";
import { ThemeSync } from "@/components/theme-sync";
import { deploymentEnvironment } from "@/lib/build-info";
import { DARK_CLASS, THEME_COOKIE, parseScheme, themeScript } from "@/lib/theme";
import { getThemePreference } from "@/lib/user-preferences";
import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import "./globals.css";

const inter = localFont({
  src: [
    {
      path: "../../node_modules/inter-ui/variable-latin/InterVariable-subset.woff2",
      weight: "100 900",
      style: "normal",
    },
    {
      path: "../../node_modules/inter-ui/variable-latin/InterVariable-Italic-subset.woff2",
      weight: "100 900",
      style: "italic",
    },
  ],
  variable: "--font-sans",
  display: "swap",
});

const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

/**
 * The header's gear, as a tab icon. Production, QA and a local `npm run dev`
 * each get their own color, for the same reason the header carries an
 * environment badge: so the wrong tab is obvious before you edit it.
 */
export async function generateMetadata(): Promise<Metadata> {
  const environment = deploymentEnvironment();
  const icon = environment === "dev" ? "favicon-dev" : environment ? "favicon-qa" : "favicon";
  const baseUrl =
    environment === "qa" ? "https://qa.harnessevents.io" : "https://harnessevents.io";

  return {
    title: "Harness Events",
    description: "Event Orchestration for Harness.",
    metadataBase: new URL(baseUrl),
    openGraph: {
      title: "Harness Events",
      description: "Event Orchestration for Harness.",
      images: [{ url: "/wsgear.png", width: 128, height: 128 }],
    },
    twitter: {
      card: "summary",
      title: "Harness Events",
      description: "Event Orchestration for Harness.",
      images: ["/wsgear.png"],
    },
    icons: {
      icon: { url: `/${icon}.svg`, type: "image/svg+xml" },
      apple: `/${icon}-apple.png`,
    },
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const theme = await getThemePreference();
  const cookieScheme = parseScheme((await cookies()).get(THEME_COOKIE)?.value);

  const dark = theme === "dark" || (theme !== "light" && cookieScheme === "dark");

  return (
    <html
      lang="en"
      className={dark ? DARK_CLASS : undefined}
      style={{ colorScheme: dark ? "dark" : "light" }}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript(theme, cookieScheme) }} />
      </head>
      <body className={`${inter.variable} ${geistMono.variable} font-sans antialiased`}>
        <ThemeSync preference={theme} />
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
