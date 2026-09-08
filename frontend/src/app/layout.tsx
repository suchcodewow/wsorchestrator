/** The root layout: fonts, theme, and the shell around every page. */

import { MotionProvider } from "@/components/motion-provider";
import { ThemeSync } from "@/components/theme-sync";
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

export const metadata: Metadata = {
  title: "Harness Events",
  description: "Event Orchestration for Harness.",
};

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
