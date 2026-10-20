"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { brandCss, isSafeAssetUrl, type Brand } from "@/lib/brand";

interface BrandContextValue {
  brand: Brand;
  /** Swap the live brand without a reload (after publishing, or when /auth/me reports a new version). */
  applyBrand: (next: Brand) => void;
}

const BrandContext = createContext<BrandContextValue | null>(null);

function setIcon(rel: string, href: string | null | undefined) {
  if (!isSafeAssetUrl(href)) return;
  document.head.querySelectorAll<HTMLLinkElement>(`link[rel="${rel}"]`).forEach((link) => {
    link.href = href;
  });
}

export function BrandProvider({ brand: initial, children }: { brand: Brand; children: ReactNode }) {
  const [brand, setBrand] = useState(initial);

  const applyBrand = useCallback((next: Brand) => {
    const root = document.documentElement;
    let style = document.getElementById("brand-tokens");
    if (!style) {
      style = document.createElement("style");
      style.id = "brand-tokens";
      document.head.appendChild(style);
    }
    style.textContent = brandCss(next);
    root.dataset.brandVersion = next.version;
    root.dataset.font = next.font;
    root.dataset.sidebar = next.sidebar_style;
    root.dataset.radius = next.radius;
    root.dir = next.dir;
    root.lang = next.default_locale || "en";
    setIcon("icon", next.icons["favicon-32"]);
    setIcon("shortcut icon", next.icons["favicon-ico"]);
    setIcon("apple-touch-icon", next.icons["apple-touch-180"]);
    const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (theme && next.tokens) theme.content = next.theme_color;
    setBrand(next);
  }, []);

  const value = useMemo(() => ({ brand, applyBrand }), [brand, applyBrand]);
  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand(): BrandContextValue {
  const value = useContext(BrandContext);
  if (!value) throw new Error("useBrand must be used inside BrandProvider");
  return value;
}
