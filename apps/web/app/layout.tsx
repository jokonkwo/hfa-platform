import type { Metadata } from "next";
import { Barlow, Geist_Mono } from "next/font/google";
import "./globals.css";

// Barlow: closest freely-available alternative to DIN Pro (Reventure's font).
// Geometric sans-serif, similar x-height and spacing characteristics.
const barlow = Barlow({
  weight: ["400", "500", "600", "700"],
  variable: "--font-barlow",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Healthy Fresno Air",
  description:
    "Real-time, ZIP-level air quality (PM2.5 / AQI) for Fresno County.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${barlow.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
