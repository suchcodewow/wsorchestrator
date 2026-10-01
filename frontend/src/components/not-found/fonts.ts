/**
 * The display faces the 404 scenes dress up in.
 *
 * None of them is preloaded: only one scene renders per miss, so preloading all
 * five would fetch four faces nobody sees. Each scene puts its own `variable`
 * class on its root and reaches the face through that custom property.
 */

import {
  Anton,
  Permanent_Marker,
  Playfair_Display,
  Press_Start_2P,
  UnifrakturMaguntia,
} from "next/font/google";

export const anton = Anton({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-anton",
  display: "swap",
  preload: false,
});

export const pressStart = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-arcade",
  display: "swap",
  preload: false,
});

export const blackletter = UnifrakturMaguntia({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-blackletter",
  display: "swap",
  preload: false,
});

export const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
  preload: false,
});

export const marker = Permanent_Marker({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-marker",
  display: "swap",
  preload: false,
});
