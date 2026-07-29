import type { Metadata } from "next";
import "./globals.css";

const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  "https://llucid-97.github.io/crossboard"
).replace(/\/+$/, "");
const title = "Crossboard — four-player chess, peer to peer";
const description =
  "Play four-player chess in teams or free-for-all rooms with casual computer opponents and automatic coordinator handoff.";
const socialImage = `${siteUrl}/og.png`;

export const metadata: Metadata = {
  metadataBase: new URL(`${siteUrl}/`),
  title,
  description,
  alternates: {
    canonical: `${siteUrl}/`,
  },
  openGraph: {
    type: "website",
    url: `${siteUrl}/`,
    title,
    description,
    images: [
      {
        url: socialImage,
        width: 1730,
        height: 909,
        alt: "Crossboard — Four sides. One board.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [socialImage],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
