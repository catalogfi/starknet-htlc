const config: import("jest").Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.json" }],
  },
  moduleFileExtensions: ["ts", "js"],
  testMatch: ["**/tests/**/*.test.ts"],
  snapshotSerializers: ["<rootDir>/tests/bigintSerializer.ts"],
  testTimeout: 30000,
};

export default config;