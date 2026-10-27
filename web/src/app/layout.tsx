import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NYU Course Planner",
  description: "See the courses you still need, what you can take next, and every section option.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
