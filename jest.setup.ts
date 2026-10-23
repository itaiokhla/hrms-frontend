import { configure } from "@testing-library/react";

// findBy*/waitFor give up after 5 s instead of 1 s: the full jest run is CPU-bound (parallel workers) and slow
// asynchronous steps (Blob.text in jsdom, framer-motion mounts) occasionally took longer than 1 s (F-64).
configure({ asyncUtilTimeout: 5000 });
