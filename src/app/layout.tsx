import "./globals.css";

import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans, Noto_Sans_Arabic, Noto_Sans_Devanagari, Plus_Jakarta_Sans, Poppins, Roboto } from "next/font/google";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { HostBlocked } from "@/components/layout/HostBlocked";
import { brandCss, isSafeAssetUrl } from "@/lib/brand";
import { getBrand } from "@/lib/brand-server";

import { Providers } from "./providers";

// Curated brand fonts, self-hosted by next/font (no requests to third-party font hosts).
const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const display = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const poppins = Poppins({ subsets: ["latin", "devanagari"], weight: ["400", "500", "600", "700"], variable: "--font-poppins", display: "swap" });
const roboto = Roboto({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-roboto", display: "swap" });
const noto = Noto_Sans({ subsets: ["latin", "cyrillic", "greek"], variable: "--font-noto", display: "swap" });
const notoArabic = Noto_Sans_Arabic({ subsets: ["arabic"], variable: "--font-noto-arabic", display: "swap" });
const notoDevanagari = Noto_Sans_Devanagari({ subsets: ["devanagari"], variable: "--font-noto-devanagari", display: "swap" });
const FONT_VARIABLES = [sans, display, poppins, roboto, noto, notoArabic, notoDevanagari].map((f) => f.variable).join(" ");

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  const icon = (name: keyof typeof brand.icons) => (isSafeAssetUrl(brand.icons[name]) ? brand.icons[name]! : null);
  const favicon32 = icon("favicon-32");
  return {
    title: { default: brand.product_name, template: `%s · ${brand.product_name}` },
    description: brand.tagline || `${brand.display_name} on ${brand.product_name}`,
    applicationName: brand.product_name,
    manifest: "/manifest.webmanifest",
    icons: favicon32
      ? {
          icon: [
            { url: favicon32, sizes: "32x32", type: "image/png" },
            ...(icon("favicon-16") ? [{ url: icon("favicon-16")!, sizes: "16x16", type: "image/png" }] : []),
          ],
          shortcut: icon("favicon-ico") ?? undefined,
          apple: icon("apple-touch-180") ?? undefined,
        }
      : undefined,
    // Tenant hosts are private workspaces.
    robots: brand.host_kind === "PLATFORM" ? undefined : { index: false, follow: false },
    other: { "brand-version": brand.version },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const brand = await getBrand();
  if (!brand.tokens) {
    return {
      themeColor: [
        { media: "(prefers-color-scheme: light)", color: "#f7f8fc" },
        { media: "(prefers-color-scheme: dark)", color: "#0d0f17" },
      ],
    };
  }
  return { themeColor: brand.theme_color };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const brand = await getBrand();
  const path = (await headers()).get("x-hrms-pathname") || "/";
  if (brand.redirect_to_primary && brand.primary_url && /^https?:\/\/[a-z0-9.-]+(:\d+)?$/.test(brand.primary_url)) {
    redirect(`${brand.primary_url}${path.startsWith("/") ? path : "/"}`);
  }
  const css = brandCss(brand);
  const blocked = brand.host_kind === "UNKNOWN" ? "unknown" : brand.host_status === "SUSPENDED" ? "suspended" : null;
  return (
    <html
      lang={brand.default_locale || "en"}
      dir={brand.dir}
      data-brand-version={brand.version}
      data-font={brand.font}
      data-sidebar={brand.sidebar_style}
      data-radius={brand.radius}
      suppressHydrationWarning
      className={FONT_VARIABLES}
    >
      <head>
        {/* Rendered on the server, so the very first paint already uses this host's brand. */}
        <style id="brand-tokens" dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>
        <Providers brand={brand}>{blocked ? <HostBlocked kind={blocked} brand={brand} /> : children}</Providers>
      </body>
    </html>
  );
}
