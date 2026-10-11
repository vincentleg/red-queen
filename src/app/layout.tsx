import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RED QUEEN — The Evolution Chamber",
  description: "A self-improving AI agent harness. Every fix must survive its own attack. Phase 0: the chamber foundation.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
