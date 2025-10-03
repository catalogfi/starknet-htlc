const config: import("jest").Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.json" }],
  },
  moduleFileExtensions: ["ts", "js"],
  testMatch: ["**/tests/**/*.test.ts"],
  snapshotSerializers: ["<rootDir>/tests/bigintSerializer.ts"],
  testTimeout: 300000,
  // For sequential execution
  maxWorkers: 1,
};

export default config;
