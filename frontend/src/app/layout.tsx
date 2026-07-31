import { MotionProvider } from "@/components/motion-provider";
import { themeScript } from "@/lib/theme";
import { getThemePreference } from "@/lib/theme-preference";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Harness Events",
  description: "Event Orchestration for Harness.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const theme = await getThemePreference();

  return (
    // The theme class is written onto <html> by the script below rather than
    // rendered here, because `system` can only be resolved in the browser.
    // That leaves the served markup not matching the hydrated DOM, which is
    // exactly what suppressHydrationWarning is for.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
         * Inlined and synchronous on purpose: it has to run before the browser
         * paints, or a dark-mode user sees a white flash on every navigation
         * that hits the server.
         */}
        <script dangerouslySetInnerHTML={{ __html: themeScript(theme) }} />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
