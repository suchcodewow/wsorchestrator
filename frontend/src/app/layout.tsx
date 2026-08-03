import { MotionProvider } from "@/components/motion-provider";
import { ThemeSync } from "@/components/theme-sync";
import { DARK_CLASS, THEME_COOKIE, parseScheme, themeScript } from "@/lib/theme";
import { getThemePreference } from "@/lib/user-preferences";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Harness Events",
  description: "Event Orchestration for Harness.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const theme = await getThemePreference();
  const cookieScheme = parseScheme((await cookies()).get(THEME_COOKIE)?.value);

  // Whether to render dark server-side. `light`/`dark` are decided by the
  // preference alone; `system` leans on the cached cookie scheme so the class
  // here matches what the inlined script paints — no client `matchMedia` at
  // first paint. A first-ever visit has no cookie and renders light; the script
  // and ThemeSync then resolve and cache the real scheme.
  const dark = theme === "dark" || (theme !== "light" && cookieScheme === "dark");

  return (
    // `system` can differ from the cookie on the first visit or right after an
    // OS-appearance change, so the served markup may not match the hydrated
    // DOM for one paint — which is exactly what suppressHydrationWarning is for.
    <html
      lang="en"
      className={dark ? DARK_CLASS : undefined}
      style={{ colorScheme: dark ? "dark" : "light" }}
      suppressHydrationWarning
    >
      <head>
        {/*
         * Inlined and synchronous on purpose: it has to run before the browser
         * paints, or a dark-mode user sees a white flash on every navigation
         * that hits the server.
         */}
        <script dangerouslySetInnerHTML={{ __html: themeScript(theme, cookieScheme) }} />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <ThemeSync preference={theme} />
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
