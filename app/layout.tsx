import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./recall.css";
import { PreviewProvider } from "@/components/recall/PreviewProvider";
import previewData from "@/fixtures/recall-preview.json";

export const metadata: Metadata = {
  title: "Recall",
  description: "Cues, not answers. Familiar conversations, in your own words.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased"><PreviewProvider data={previewData}>{children}</PreviewProvider></body>
    </html>
  );
}
