const nextJest = require("next/jest");

const createJestConfig = nextJest({ dir: "./" });

module.exports = createJestConfig({
  testEnvironment: "jsdom",
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
  testMatch: ["<rootDir>/src/**/__tests__/**/*.test.{ts,tsx}"],
  // The full suite runs ~50 files in parallel workers; under that load a findBy* query can need more than
  // Testing Library's default 1 s (F-64). Waits only: every assertion stays the same.
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testTimeout: 20000,
});
