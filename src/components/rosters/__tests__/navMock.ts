/**
 * A next/navigation stand-in whose query string lives in a small store, so `router.replace` re-renders the
 * `useSearchParams` readers (useListQuery) the way the App Router does. Use with
 * `jest.mock("next/navigation", () => require("./navMock").navigationMock())` and call `resetUrl()` before each test.
 */
import { useSyncExternalStore } from "react";

let search = new URLSearchParams();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export const replace = jest.fn((url: string) => {
  search = new URLSearchParams(url.split("?")[1] ?? "");
  listeners.forEach((listener) => listener());
});

export function resetUrl(query = "") {
  search = new URLSearchParams(query);
  replace.mockClear();
}

/** The current query string (what the address bar would show). */
export const currentQuery = () => search.toString();

export function navigationMock() {
  const router = { push: replace, replace, back: jest.fn(), forward: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() };
  return {
    useRouter: () => router,
    usePathname: () => "/attendance/open-shifts",
    useSearchParams: () => useSyncExternalStore(subscribe, () => search, () => search),
    useParams: () => ({}),
  };
}
