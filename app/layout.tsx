import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./recall.css";
import { LiveProvider } from "@/components/live/LiveProvider";

export const metadata: Metadata = {
  title: "Recall",
  description: "Cues, not answers. Familiar conversations, in your own words.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased"><LiveProvider>{children}</LiveProvider></body>
    </html>
  );
}
