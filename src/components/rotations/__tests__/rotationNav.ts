/**
 * A next/navigation stand-in for the rotation pages: the query string lives in a small store so `router.push` /
 * `replace` re-render the `useSearchParams` readers (useModalRoute, useTabParam). Use with
 * `jest.mock("next/navigation", () => require("./rotationNav").navigationMock())` and `resetUrl()` before each test.
 */
import { useSyncExternalStore } from "react";

let search = new URLSearchParams();
let pathname = "/attendance/rotations";
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

const go = (url: string) => {
  const [path, query] = url.split("?");
  if (path) pathname = path;
  search = new URLSearchParams(query ?? "");
  listeners.forEach((listener) => listener());
};

export const push = jest.fn(go);
export const replace = jest.fn(go);

export function resetUrl(path = "/attendance/rotations", query = "") {
  pathname = path;
  search = new URLSearchParams(query);
  push.mockClear();
  replace.mockClear();
}

export function navigationMock() {
  const router = { push, replace, back: jest.fn(), forward: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() };
  return {
    useRouter: () => router,
    usePathname: () => useSyncExternalStore(subscribe, () => pathname, () => pathname),
    useSearchParams: () => useSyncExternalStore(subscribe, () => search, () => search),
    useParams: () => ({}),
  };
}
