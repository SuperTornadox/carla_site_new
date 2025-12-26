import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Carla Gannis Studio",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
