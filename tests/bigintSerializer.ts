export const bigintSerializer = {
    test: (val: unknown): boolean => typeof val === "bigint",
    print: (val: bigint): string => `BigInt("${val.toString()}")`,
  };

  export default bigintSerializer;