import { MotionProvider } from "@/components/motion-provider";
import { ThemeSync } from "@/components/theme-sync";
import { DARK_CLASS, THEME_COOKIE, parseScheme, themeScript } from "@/lib/theme";
import { getThemePreference } from "@/lib/user-preferences";
import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import "./globals.css";

/*
 * Inter comes from the `inter-ui` package rather than `next/font/google` on
 * purpose. Google's build of Inter is stripped of the character variants —
 * no `cv05`, no `cv08` — and this app spends most of its time rendering
 * domains, emails and GCP identifiers, which is exactly where an `l` that
 * cannot be told from an `I` costs a support ticket. The upstream release
 * carries them, plus an `opsz` axis, in one 97KB variable file that covers
 * every weight. See the feature settings in globals.css.
 */
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

/*
 * Mono is load-bearing here — project ids, org unit paths, log panes, the SQL
 * console — and nearly all of it is long unbreakable strings at 12px inside
 * `break-all` spans. Geist Mono is narrow and ligature-free, which is what
 * that wants; a wider coding face would wrap those identifiers sooner.
 */
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

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
      <body className={`${inter.variable} ${geistMono.variable} font-sans antialiased`}>
        <ThemeSync preference={theme} />
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
