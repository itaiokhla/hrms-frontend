import { isSafeAssetUrl } from "@/lib/brand";
import { getBrand } from "@/lib/brand-server";

export const dynamic = "force-dynamic";

/** Installed-app manifest for this host's brand (01-white-label §5.8). */
export async function GET() {
  const brand = await getBrand();
  const icons = (
    [
      ["pwa-192", "192x192", "any"],
      ["pwa-512", "512x512", "any"],
      ["maskable-512", "512x512", "maskable"],
    ] as const
  )
    .filter(([name]) => isSafeAssetUrl(brand.icons[name]))
    .map(([name, sizes, purpose]) => ({ src: brand.icons[name]!, sizes, type: "image/png", purpose }));
  const manifest = {
    name: brand.product_name,
    short_name: brand.short_name || brand.product_name.slice(0, 12),
    description: brand.tagline || brand.display_name,
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: brand.theme_color,
    lang: brand.default_locale,
    dir: brand.dir,
    icons,
  };
  return new Response(JSON.stringify(manifest), {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "private, max-age=60",
      Vary: "Host, Cookie",
    },
  });
}
