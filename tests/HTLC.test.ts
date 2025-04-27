import {
  Account,
  cairo,
  CallData,
  Contract,
  RpcProvider,
  shortString,
  TypedData,
  WeierstrassSignatureType,
  TypedDataRevision,
  stark as sn,
} from "starknet";
import {
  generateOrderId,
  getCompiledCode,
  hexToU32Array,
  mineStarknetBlocks,
} from "./utils";
import { ethers, parseEther, sha256 } from "ethers";
import { randomBytes } from "crypto";
import { HTLC, HTLC_ARTIFACTS } from "./abi/htlc";
import { SEED, SEED_ARTIFACTS } from "./abi/seed";
import { HTLC as BitcoinHTLC } from "./bitcoin/htlc";
import hre from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  BitcoinNetwork,
  BitcoinProvider,
  BitcoinWallet,
} from "@catalogfi/wallets";
import { regTestUtils } from "./bitcoin/regtest";
import { BITCOIN_NODE_URL, STARKNET_DEVNET_URL } from "./config";

describe("Starknet HTLC", () => {
  const starknetProvider = new RpcProvider({
    nodeUrl: STARKNET_DEVNET_URL,
  });

  // Prefund accounts from devnet
  const accounts = [
    {
      address:
        "0x0260a8311b4f1092db620b923e8d7d20e76dedcc615fb4b6fdf28315b81de201",
      privateKey:
        "0x00000000000000000000000000000000c10662b7b247c7cecf7e8a30726cff12",
      publicKey:
        "0x02aa653a9328480570f628492a951c07621878fa429ac08bdbf2c9c388ae88b7",
    },
    {
      address:
        "0x014923a0e03ec4f7484f600eab5ecf3e4eacba20ffd92d517b213193ea991502",
      privateKey:
        "0x00000000000000000000000000000000e5852452e0757e16b127975024ade3eb",
      publicKey:
        "0x055c96342ff1304a2807755209735a35a7220ec18153cb516e376d47e6471083",
    },
    {
      address:
        "0x018f81c2ef42310e0abd4fafd27f37beb34d000641beb2cd8a6fb97596552ddb",
      privateKey:
        "0x0000000000000000000000000000000016b0be70a6344cccf3ed6e7d9cf04de4",
      publicKey:
        "0x0795974d45796c18ff5ae856dd20a3f1878061510f0fef5da10ade4393ecbf92",
    },
  ];

  // Token address
  const STARK =
    "0x4718F5A0FC34CC1AF16A1CDEE98FFB20C31F5CD61D6AB07201858F4287C938D";
  const ZERO_ADDRESS =
    "0x000000000000000000000000000000000000000000000000000000000000000";
  const TIMELOCK = 10n;
  const AMOUNT = parseEther("1");
  const { low: AMOUNT_LOW, high: AMOUNT_HIGH } = cairo.uint256(AMOUNT);

  let stark: Contract;
  let starknetHTLC: Contract;
  let callData: CallData;

  let alice: Account;
  let bob: Account;
  let charlie: Account;

  let secret1: string;
  let secret2: string;
  let secret3: string;
  let secret4: string;
  let secret5: string;
  let secret6: string;
  let secret7: string;

  let secretHash1: number[];
  let secretHash2: number[];
  let secretHash3: number[];
  let secretHash4: number[];
  let secretHash5: number[];
  let secretHash6: number[];
  let secretHash7: number[];

  let CHAIN_ID: string;

  let sierraCode, casmCode;

  interface Order {
    is_fulfilled: boolean;
    initiator: bigint;
    redeemer: bigint;
    initiated_at: bigint;
    timelock: bigint;
    amount: bigint;
  }

  const deployHTLC = async () => {
    try {
      ({ sierraCode, casmCode } = await getCompiledCode("starknet_htlc_HTLC"));
    } catch (error: any) {
      console.log("Failed to read contract files", error);
      process.exit(1);
    }
    callData = new CallData(sierraCode.abi);

    const constructor = callData.compile("constructor", {
      chain_id: CHAIN_ID,
      token: STARK,
    });

    const deployResponse = await alice.declareAndDeploy({
      contract: sierraCode,
      casm: casmCode,
      constructorCalldata: constructor,
      salt: sn.randomAddress(),
    });

    starknetHTLC = new Contract(
      sierraCode.abi,
      deployResponse.deploy.contract_address,
      starknetProvider
    );
  };

  beforeAll(async () => {
    secret1 = sha256(randomBytes(32));
    secret2 = sha256(randomBytes(32));
    secret3 = sha256(randomBytes(32));
    secret4 = sha256(randomBytes(32));
    secret5 = sha256(randomBytes(32));
    secret6 = sha256(randomBytes(32));
    secret7 = sha256(randomBytes(32));

    secretHash1 = hexToU32Array(sha256(secret1));
    secretHash2 = hexToU32Array(sha256(secret2));
    secretHash3 = hexToU32Array(sha256(secret3));
    secretHash4 = hexToU32Array(sha256(secret4));
    secretHash5 = hexToU32Array(sha256(secret5));
    secretHash6 = hexToU32Array(sha256(secret6));
    secretHash7 = hexToU32Array(sha256(secret7));

    CHAIN_ID = (await starknetProvider.getChainId()).toString();

    alice = new Account(
      starknetProvider,
      accounts[0].address,
      accounts[0].privateKey
    );

    bob = new Account(
      starknetProvider,
      accounts[1].address,
      accounts[1].privateKey
    );
    charlie = new Account(
      starknetProvider,
      accounts[2].address,
      accounts[2].privateKey
    );

    const contractData = await starknetProvider.getClassAt(STARK);
    stark = new Contract(contractData.abi, STARK, starknetProvider);
    await deployHTLC();

    // allowance for HTLC
    stark.connect(alice);
    await stark.approve(starknetHTLC.address, parseEther("500"));
    stark.connect(bob);
    await stark.approve(starknetHTLC.address, parseEther("500"));
    stark.connect(charlie);
    await stark.approve(starknetHTLC.address, parseEther("500"));
  }, 100000);

  describe("- Pre-Conditions -", () => {
    it("HTLC should have 0 STARK token.", async () => {
      expect(await stark.balanceOf(starknetHTLC.address)).toBe(0n);
    });

    it("Should be deployed with correct token address", async () => {
      expect(await starknetHTLC.token()).toBe(BigInt(STARK)); // token() returns a felt252
    });
  });

  describe("-- HTLC Initiate --", () => {
    it("Should not able to initiate with no redeemer.", async () => {
      await expect(
        alice.execute({
          contractAddress: starknetHTLC.address,
          entrypoint: "initiate",
          calldata: [
            ZERO_ADDRESS,
            TIMELOCK,
            AMOUNT_LOW,
            AMOUNT_HIGH,
            ...secretHash1,
          ], // Cairo expects parameters in this format
        })
      ).rejects.toThrow("HTLC: zero address redeemer");
    });

    it("Should not able to initiate a swap with no amount.", async () => {
      const zeroU256 = { low: 0n, high: 0n };
      await expect(
        alice.execute({
          contractAddress: starknetHTLC.address,
          entrypoint: "initiate",
          calldata: [
            bob.address,
            TIMELOCK,
            zeroU256.low,
            zeroU256.high,
            ...secretHash1,
          ],
        })
      ).rejects.toThrow("HTLC: zero amount");
    });

    it("Should not able to initiate a swap with a 0 expiry.", async () => {
      await expect(
        alice.execute({
          contractAddress: starknetHTLC.address,
          entrypoint: "initiate",
          calldata: [bob.address, 0n, AMOUNT_LOW, AMOUNT_HIGH, ...secretHash1],
        })
      ).rejects.toThrow("HTLC: zero timelock");
    });

    it("Should not able to initiate a swap with a same initiator and redeemer.", async () => {
      await expect(
        alice.execute({
          contractAddress: starknetHTLC.address,
          entrypoint: "initiate",
          calldata: [
            alice.address,
            TIMELOCK,
            AMOUNT_LOW,
            AMOUNT_HIGH,
            ...secretHash1,
          ],
        })
      ).rejects.toThrow("HTLC: same initiator & redeemer");
    });

    it("Should not able to initiate swap with amount greater than allowance.", async () => {
      const { low, high } = cairo.uint256(parseEther("600"));
      await expect(
        alice.execute({
          contractAddress: starknetHTLC.address,
          entrypoint: "initiate",
          calldata: [bob.address, TIMELOCK, low, high, ...secretHash1],
        })
      ).rejects.toThrow("ERC20: insufficient allowance");
    });

    it("Should not able to initiate swap with amount greater than balance.", async () => {
      const amount = parseEther("5000");
      stark.connect(bob);
      await stark.approve(starknetHTLC.address, amount);

      const { low, high } = cairo.uint256(amount);
      await expect(
        bob.execute({
          contractAddress: starknetHTLC.address,
          entrypoint: "initiate",
          calldata: [alice.address, TIMELOCK, low, high, ...secretHash1],
        })
      ).rejects.toThrow("ERC20: insufficient balance");
    });

    it("Should able to initiate a swap with correct parameters.", async () => {
      await alice.execute({
        contractAddress: starknetHTLC.address,
        entrypoint: "initiate",
        calldata: [
          bob.address,
          TIMELOCK,
          AMOUNT_LOW,
          AMOUNT_HIGH,
          ...secretHash1,
        ],
      });
    });

    it("Should not be able to initiate a swap with same secret.", async () => {
      await expect(
        alice.execute({
          contractAddress: starknetHTLC.address,
          entrypoint: "initiate",
          calldata: [
            bob.address,
            TIMELOCK,
            AMOUNT_LOW,
            AMOUNT_HIGH,
            ...secretHash1,
          ],
        })
      ).rejects.toThrow("HTLC: duplicate order");
    });

    it("Should able to initiate another swap with different secret.", async () => {
      await alice.execute({
        contractAddress: starknetHTLC.address,
        entrypoint: "initiate",
        calldata: [
          bob.address,
          TIMELOCK,
          AMOUNT_LOW,
          AMOUNT_HIGH,
          ...secretHash2,
        ],
      });
    });
  });

  describe("-- HTLC Initiate on Behalf --", () => {
    it("Should not able to initiate with no redeemer.", async () => {
      await expect(
        alice.execute({
          contractAddress: starknetHTLC.address,
          entrypoint: "initiate_on_behalf",
          calldata: [
            ZERO_ADDRESS,
            ZERO_ADDRESS,
            TIMELOCK,
            AMOUNT_LOW,
            AMOUNT_HIGH,
            ...secretHash1,
          ],
        })
      ).rejects.toThrow("HTLC: zero address redeemer");
    });

    it("Should not able to initiate a swap with no amount.", async () => {
      const zeroU256 = { low: 0n, high: 0n };
      await expect(
        alice.execute({
          contractAddress: starknetHTLC.address,
          entrypoint: "initiate_on_behalf",
          calldata: [
            alice.address,
            bob.address,
            TIMELOCK,
            zeroU256.low,
            zeroU256.high,
            ...secretHash1,
          ],
        })
      ).rejects.toThrow("HTLC: zero amount");
    });

    it("Should not able to initiate a swap with a 0 expiry.", async () => {
      await expect(
        alice.execute({
          contractAddress: starknetHTLC.address,
          entrypoint: "initiate_on_behalf",
          calldata: [alice.address,bob.address, 0n, AMOUNT_LOW, AMOUNT_HIGH, ...secretHash1],
        })
      ).rejects.toThrow("HTLC: zero timelock");
    });

    it("Should able to initiate a swap on belhalf with correct parameters.", async () => {
      await alice.execute({
        contractAddress: starknetHTLC.address,
        entrypoint: "initiate_on_behalf",
        calldata: [
          alice.address,
          bob.address,
          10n,
          AMOUNT_LOW,
          AMOUNT_HIGH,
          ...secretHash3,
        ],
      });
    });

    it("Should able to initiate another swap with different secret.", async () => {
      await alice.execute({
        contractAddress: starknetHTLC.address,
        entrypoint: "initiate_on_behalf",
        calldata: [
          alice.address,
          bob.address,
          10n,
          AMOUNT_LOW,
          AMOUNT_HIGH,
          ...secretHash4,
        ],
      });
    });
  });

  describe("-- HTLC Initiate with Signature --", () => {
    const INTIATE_TYPE = {
      StarknetDomain: [
        { name: "name", type: "shortstring" },
        { name: "version", type: "shortstring" },
        { name: "chainId", type: "shortstring" },
        { name: "revision", type: "shortstring" },
      ],
      Initiate: [
        { name: "redeemer", type: "ContractAddress" },
        { name: "amount", type: "u256" },
        { name: "timelock", type: "u128" },
        { name: "secretHash", type: "u128*" },
      ],
    };

    const DOMAIN = {
      name: "HTLC",
      version: shortString.encodeShortString("1"),
      chainId: "0x534e5f5345504f4c4941", // SN_SEPOLIA
      revision: TypedDataRevision.ACTIVE,
    };

    it("Should not able to initiate with no redeemer.", async () => {

      const initiate: TypedData = {
        domain: DOMAIN,
        primaryType: "Initiate",
        types: INTIATE_TYPE,
        message: {
          redeemer: bob.address,
          amount: cairo.uint256(AMOUNT),
          timelock: TIMELOCK,
          secretHash: secretHash7,
        },
      };

      const signature = (await alice.signMessage(
        initiate
      )) as WeierstrassSignatureType;
      const { r, s } = signature;

      await expect(
        alice.execute({
          contractAddress: starknetHTLC.address,
          entrypoint: "initiate_with_signature",
          calldata: [
            charlie.address,
            ZERO_ADDRESS,
            TIMELOCK,
            AMOUNT_LOW,
            AMOUNT_HIGH,
            ...secretHash7,
            [r, s],
          ],
        })
      ).rejects.toThrow("HTLC: zero address redeemer");
    });

    it("Should not able to initiate a swap with no amount.", async () => {

      const initiate: TypedData = {
        domain: DOMAIN,
        primaryType: "Initiate",
        types: INTIATE_TYPE,
        message: {
          redeemer: bob.address,
          amount: cairo.uint256(0),
          timelock: TIMELOCK,
          secretHash: secretHash7,
        },
      };

      const signature = (await alice.signMessage(
        initiate
      )) as WeierstrassSignatureType;
      const { r, s } = signature;

      const zeroU256 = { low: 0n, high: 0n };
      await expect(
        alice.execute({
          contractAddress: starknetHTLC.address,
          entrypoint: "initiate_with_signature",
          calldata: [
            alice.address,
            bob.address,
            TIMELOCK,
            zeroU256.low,
            zeroU256.high,
            ...secretHash7,
            [r, s],
          ],
        })
      ).rejects.toThrow("HTLC: zero amount");
    });

    it("Should not able to initiate a swap with a 0 expiry.", async () => {
      const initiate: TypedData = {
        domain: DOMAIN,
        primaryType: "Initiate",
        types: INTIATE_TYPE,
        message: {
          redeemer: bob.address,
          amount: cairo.uint256(AMOUNT),
          timelock: 0,
          secretHash: secretHash7,
        },
      };

      const signature = (await alice.signMessage(
        initiate
      )) as WeierstrassSignatureType;
      const { r, s } = signature;

      await expect(
        alice.execute({
          contractAddress: starknetHTLC.address,
          entrypoint: "initiate_with_signature",
          calldata: [
            charlie.address,
            bob.address,
            0,
            AMOUNT_LOW,
            AMOUNT_HIGH,
            ...secretHash7,
            [r, s],
          ],
        })
      ).rejects.toThrow("HTLC: zero timelock");
    });

    it("Should not be able to initiate a swap with invalid signature.", async () => {
      const initiate: TypedData = {
        domain: DOMAIN,
        primaryType: "Initiate",
        types: INTIATE_TYPE,
        message: {
          redeemer: bob.address,
          amount: cairo.uint256(AMOUNT),
          timelock: TIMELOCK,
          secretHash: secretHash7,
        },
      };

      const signature = (await alice.signMessage(
        initiate
      )) as WeierstrassSignatureType;
      const { r, s } = signature;

      await expect(
        alice.execute({
          contractAddress: starknetHTLC.address,
          entrypoint: "initiate_with_signature",
          calldata: [
            charlie.address,
            bob.address,
            TIMELOCK,
            AMOUNT_LOW,
            AMOUNT_HIGH,
            ...secretHash7,
            [r, s],
          ],
        })
      ).rejects.toThrow("HTLC: invalid initiator signature");
    });

    it("Should able to initiate a swap with valid signature.", async () => {
      const initiate: TypedData = {
        domain: DOMAIN,
        primaryType: "Initiate",
        types: INTIATE_TYPE,
        message: {
          redeemer: bob.address,
          amount: cairo.uint256(AMOUNT),
          timelock: TIMELOCK,
          secretHash: secretHash5,
        },
      };

      const signature = (await alice.signMessage(
        initiate
      )) as WeierstrassSignatureType;
      const { r, s } = signature;

      await alice.execute({
        contractAddress: starknetHTLC.address,
        entrypoint: "initiate_with_signature",
        calldata: [
          alice.address,
          bob.address,
          TIMELOCK,
          AMOUNT_LOW,
          AMOUNT_HIGH,
          ...secretHash5,
          [r, s],
        ],
      });
    });
  });

  describe("-- HTLC - Redeem --", () => {
    it("Bob should not be able to redeem a swap with no initiate.", async () => {
      let randomSecret = ethers.sha256(randomBytes(32));
      let secretHash = hexToU32Array(ethers.sha256(randomSecret));
      const randomOrderID = generateOrderId(
        CHAIN_ID,
        alice.address,
        bob.address,
        TIMELOCK,
        AMOUNT,
        secretHash
      );

      await expect(
        alice.execute({
          contractAddress: starknetHTLC.address,
          entrypoint: "redeem",
          calldata: {
            orderId: randomOrderID,
            secret: hexToU32Array(randomSecret, "big").map(BigInt),
          },
        })
      ).rejects.toThrow("HTLC: order not initiated");
    });

    it("Bob should not be able to redeem a swap with invalid secret.", async () => {
      const orderId = generateOrderId(
        CHAIN_ID,
        alice.address,
        bob.address,
        TIMELOCK,
        AMOUNT,
        secretHash1
      );
      const invalidSecret = randomBytes(32).toString("hex");
      await expect(
        bob.execute({
          contractAddress: starknetHTLC.address,
          entrypoint: "redeem",
          calldata: {
            orderId: orderId,
            secret: hexToU32Array(invalidSecret).map(BigInt),
          },
        })
      ).rejects.toThrow("HTLC: incorrect secret");
    });

    it("Bob should be able to redeem a swap with valid secret.", async () => {
      const orderId = generateOrderId(
        CHAIN_ID,
        alice.address,
        bob.address,
        TIMELOCK,
        AMOUNT,
        secretHash1
      );

      stark.connect(bob);
      const bobOldBalance: bigint = await stark.balanceOf(bob.address);

      await charlie.execute({
        contractAddress: starknetHTLC.address,
        entrypoint: "redeem",
        calldata: {
          orderId: orderId,
          secret: hexToU32Array(secret1).map(BigInt),
        },
      });

      const bobBalanceAfterRedeem = await stark.balanceOf(bob.address);
      expect(bobOldBalance + AMOUNT).toBe(bobBalanceAfterRedeem);
    });

    it("Bob should not be able to redeem a swap which is already redeemed.", async () => {
      const orderId = generateOrderId(
        CHAIN_ID,
        alice.address,
        bob.address,
        TIMELOCK,
        AMOUNT,
        secretHash1
      );
      await expect(
        bob.execute({
          contractAddress: starknetHTLC.address,
          entrypoint: "redeem",
          calldata: {
            orderId: orderId,
            secret: hexToU32Array(secret1).map(BigInt),
          },
        })
      ).rejects.toThrow("HTLC: order fulfilled");
    });

    it("Bob should receive the correct amount even if Charlie redeems with valid secret.", async () => {
      const orderId = generateOrderId(
        CHAIN_ID,
        alice.address,
        bob.address,
        TIMELOCK,
        AMOUNT,
        secretHash2
      );

      stark.connect(bob);
      const bobOldBalance: bigint = await stark.balanceOf(bob.address);

      await charlie.execute({
        contractAddress: starknetHTLC.address,
        entrypoint: "redeem",
        calldata: {
          orderId: orderId,
          secret: hexToU32Array(secret2).map(BigInt),
        },
      });

      const bobBalanceAfterRedeem = await stark.balanceOf(bob.address);
      expect(bobOldBalance + AMOUNT).toBe(bobBalanceAfterRedeem);
    });
  });

  describe("-- HTLC - Refund --", () => {
    it("Alice should not be able to refund a swap with no intiate.", async () => {
      let secret = randomBytes(32).toString("hex");
      let secretHash = hexToU32Array(secret);
      const randomOrderID = generateOrderId(
        CHAIN_ID,
        alice.address,
        bob.address,
        TIMELOCK,
        AMOUNT,
        secretHash
      );

      await expect(
        alice.execute({
          contractAddress: starknetHTLC.address,
          entrypoint: "refund",
          calldata: {
            orderId: randomOrderID,
          },
        })
      ).rejects.toThrow("HTLC: order not initiated");
    });

    it("Alice should not be able to refund a swap that is already redeemed.", async () => {
      const orderId = generateOrderId(
        CHAIN_ID,
        alice.address,
        bob.address,
        TIMELOCK,
        AMOUNT,
        secretHash1
      );
      await expect(
        alice.execute({
          contractAddress: starknetHTLC.address,
          entrypoint: "refund",
          calldata: {
            orderId: orderId,
          },
        })
      ).rejects.toThrow("HTLC: order fulfilled");
    });

    it("Alice should not be able to refund a swap earlier than the locktime.", async () => {
      const orderId = generateOrderId(
        CHAIN_ID,
        alice.address,
        bob.address,
        TIMELOCK,
        AMOUNT,
        secretHash3
      );
      await expect(
        alice.execute({
          contractAddress: starknetHTLC.address,
          entrypoint: "refund",
          calldata: {
            orderId: orderId,
          },
        })
      ).rejects.toThrow("HTLC: order not expired");
    });

    it("Alice should be able to refund a swap after the locktime.", async () => {
      const orderId = generateOrderId(
        CHAIN_ID,
        alice.address,
        bob.address,
        TIMELOCK,
        AMOUNT,
        secretHash3
      );
      await mineStarknetBlocks(10);
      const aliceBalanceBefore = await stark.balanceOf(alice.address);
      await charlie.execute({
        contractAddress: starknetHTLC.address,
        entrypoint: "refund",
        calldata: {
          orderId: orderId,
        },
      });
      const aliceBlanceAfterRefund = await stark.balanceOf(alice.address);
      expect(aliceBalanceBefore + AMOUNT).toBe(aliceBlanceAfterRefund);
    });

    it("Alice should be able to refund a swap which is already refunded.", async () => {
      const orderId = generateOrderId(
        CHAIN_ID,
        alice.address,
        bob.address,
        TIMELOCK,
        AMOUNT,
        secretHash3
      );
      await expect(
        alice.execute({
          contractAddress: starknetHTLC.address,
          entrypoint: "refund",
          calldata: {
            orderId: orderId,
          },
        })
      ).rejects.toThrow("HTLC: order fulfilled");
    });

    it("Alice should receive the correct amount even if Charlie refunds after the locktime.", async () => {
      const orderId = generateOrderId(
        CHAIN_ID,
        alice.address,
        bob.address,
        TIMELOCK,
        AMOUNT,
        secretHash4
      );
      await mineStarknetBlocks(10);

      const aliceBalanceBefore = await stark.balanceOf(alice.address);
      await charlie.execute({
        contractAddress: starknetHTLC.address,
        entrypoint: "refund",
        calldata: {
          orderId: orderId,
        },
      });
      const aliceBlanceAfterRefund = await stark.balanceOf(alice.address);
      expect(aliceBalanceBefore + AMOUNT).toBe(aliceBlanceAfterRefund);
    });
  });

  describe("--- HTLC instant Refund", () => {
    const REFUND_TYPE = {
      StarknetDomain: [
        { name: "name", type: "shortstring" },
        { name: "version", type: "shortstring" },
        { name: "chainId", type: "shortstring" },
        { name: "revision", type: "shortstring" },
      ],
      instantRefund: [{ name: "orderID", type: "felt" }],
    };

    const DOMAIN = {
      name: "HTLC",
      version: shortString.encodeShortString("1"),
      chainId: "0x534e5f5345504f4c4941", // SN_SEPOLIA
      revision: TypedDataRevision.ACTIVE,
    };

    it("Should not be able to instant refund swap with incorrect signature.", async () => {
      await alice.execute({
        contractAddress: starknetHTLC.address,
        entrypoint: "initiate",
        calldata: [
          bob.address,
          TIMELOCK,
          AMOUNT_LOW,
          AMOUNT_HIGH,
          ...secretHash6,
        ],
      });

      const orderId = generateOrderId(
        CHAIN_ID,
        alice.address,
        bob.address,
        TIMELOCK,
        AMOUNT,
        secretHash6
      );

      const refund: TypedData = {
        domain: DOMAIN,
        primaryType: "instantRefund",
        types: REFUND_TYPE,
        message: {
          orderID: orderId,
        },
      };

      const signature = (await charlie.signMessage(
        refund
      )) as WeierstrassSignatureType;
      const { r, s } = signature;

      const calldata = [orderId, [r, s]];

      await expect(
        alice.execute({
          contractAddress: starknetHTLC.address,
          entrypoint: "instant_refund",
          calldata: calldata,
        })
      ).rejects.toThrow("HTLC: invalid redeemer signature");
    });

    it("Should be able to instant refund swap with correct signature.", async () => {
      const orderId = generateOrderId(
        CHAIN_ID,
        alice.address,
        bob.address,
        TIMELOCK,
        AMOUNT,
        secretHash6
      );
      const refund: TypedData = {
        domain: DOMAIN,
        primaryType: "instantRefund",
        types: REFUND_TYPE,
        message: {
          orderID: orderId,
        },
      };

      const signature = (await bob.signMessage(
        refund
      )) as WeierstrassSignatureType;
      const { r, s } = signature;

      await alice.execute({
        contractAddress: starknetHTLC.address,
        entrypoint: "instant_refund",
        calldata: [orderId, [r, s]],
      });
    });
  });

  describe("--- HTLC - Get Order ---", () => {
    it("Should be able to get order info.", async () => {
      const orderId = generateOrderId(
        CHAIN_ID,
        alice.address,
        bob.address,
        TIMELOCK,
        AMOUNT,
        secretHash1
      );

      const orderInfo = (await starknetHTLC.call("get_order", [
        orderId,
      ])) as Order;

      expect(orderInfo).toBeTruthy();
      expect(orderInfo.is_fulfilled).toBe(true);
      expect(orderInfo.initiator).toBe(BigInt(alice.address));
      expect(orderInfo.redeemer).toBe(BigInt(bob.address));
      expect(typeof orderInfo.initiated_at).toBe("bigint");
      expect(orderInfo.timelock).toBe(TIMELOCK);
      expect(orderInfo.amount).toBe(AMOUNT);
    });
  });

  describe("--- HTLC EVM <-> Starknet ---", () => {
    let ownerEVM: HardhatEthersSigner;
    let aliceEVM: HardhatEthersSigner;
    let bobEVM: HardhatEthersSigner;

    let seed: SEED;
    let htlcEVM: HTLC;

    const secret = randomBytes(32);
    const secretHash = ethers.sha256(secret);
    let chainId: bigint;

    beforeAll(async () => {
      [ownerEVM, aliceEVM, bobEVM] = await hre.ethers.getSigners();

      const SEEDFactory = new ethers.ContractFactory(
        SEED_ARTIFACTS.abi,
        SEED_ARTIFACTS.bytecode,
        ownerEVM
      );
      const EVMHTLCFactory = new ethers.ContractFactory(
        HTLC_ARTIFACTS.abi,
        HTLC_ARTIFACTS.bytecode,
        ownerEVM
      );

      seed = (await SEEDFactory.deploy()) as SEED;
      await seed.waitForDeployment();
      console.log("SEED Contract Address : ", await seed.getAddress());

      htlcEVM = (await EVMHTLCFactory.deploy(
        await seed.getAddress(),
        "HTLC",
        "1"
      )) as HTLC;
      await htlcEVM.waitForDeployment();
      console.log("HTLC Contract Address : ", await htlcEVM.getAddress());

      // Allowance to HTLC
      await seed
        .connect(aliceEVM)
        .approve(await htlcEVM.getAddress(), parseEther("100"));

      chainId = (await hre.ethers.provider.getNetwork()).chainId;
    });

    it("Owner should have 147M SEED token.", async () => {
      expect(await seed.balanceOf(await ownerEVM.getAddress())).toBe(
        ethers.parseEther("147000000")
      );
    });

    it("Users should have 0 SEED token.", async () => {
      expect(await seed.balanceOf(await aliceEVM.getAddress())).toBe(0n);
      expect(await seed.balanceOf(await bobEVM.getAddress())).toBe(0n);
    });

    it("HTLC should have 0 SEED token.", async () => {
      expect(await seed.balanceOf(await htlcEVM.getAddress())).toBe(0n);
    });

    it("HTLC should be deployed with correct address of SEED.", async () => {
      expect(await htlcEVM.token()).toBe(await seed.getAddress());
    });

    it("Should be able to swap STARK for SEED", async () => {
      await seed
        .connect(ownerEVM)
        .transfer(aliceEVM.address, parseEther("1000"));

      // Alice initiates in EVM
      await htlcEVM
        .connect(aliceEVM)
        .initiate(bobEVM.address, TIMELOCK, parseEther("10"), secretHash);

      await bob.execute({
        contractAddress: starknetHTLC.address,
        entrypoint: "initiate",
        calldata: [
          alice.address,
          TIMELOCK,
          AMOUNT_LOW,
          AMOUNT_HIGH,
          ...hexToU32Array(secretHash).map(BigInt),
        ],
      });

      // Alice redeems on starknet
      const starknetOrderId = generateOrderId(
        CHAIN_ID,
        bob.address,
        alice.address,
        TIMELOCK,
        AMOUNT,
        hexToU32Array(secretHash)
      );
      const aliceBlanceBeforeRedeem = await stark.balanceOf(alice.address);
      await charlie.execute({
        contractAddress: starknetHTLC.address,
        entrypoint: "redeem",
        calldata: {
          orderId: starknetOrderId,
          secret: hexToU32Array(secret.toString("hex")).map(BigInt),
        },
      });
      const aliceBlanceAfterRedeem = await stark.balanceOf(alice.address);
      expect(aliceBlanceBeforeRedeem + AMOUNT).toBe(aliceBlanceAfterRedeem);

      // Bob redeems in EVM
      const orderId = ethers.sha256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "bytes32", "address"],
          [chainId, secretHash, aliceEVM.address]
        )
      );

      const bobSEEDBalanceBefore = await seed.balanceOf(bobEVM.address);
      await htlcEVM.connect(bobEVM).redeem(orderId, secret);
      // make sure alice received the SEED
      expect(await seed.balanceOf(bobEVM.address)).toBe(
        bobSEEDBalanceBefore + parseEther("10")
      );
    });
  });

  describe("--- HTLC Bitcoin <-> Starknet ---", () => {
    let BTCProvider: BitcoinProvider;
    let aliceBitcoinWallet: BitcoinWallet;
    let bobBitcoinWallet: BitcoinWallet;

    beforeAll(async () => {
      BTCProvider = new BitcoinProvider(
        BitcoinNetwork.Regtest,
        BITCOIN_NODE_URL
      );
      aliceBitcoinWallet = BitcoinWallet.createRandom(BTCProvider);
      bobBitcoinWallet = BitcoinWallet.createRandom(BTCProvider);
    });
    const secret = randomBytes(32);
    const secretHash = ethers.sha256(secret);

    const fromAmount = 10000;
    const expiry = 7200;

    it("Should be able to swap STARK for BTC", async () => {
      const bobPubkey = await bobBitcoinWallet.getPublicKey();
      const alicePubkey = await aliceBitcoinWallet.getPublicKey();
      await regTestUtils.fund(
        await aliceBitcoinWallet.getAddress(),
        BTCProvider
      );

      const aliceBitcoinHTLC = await BitcoinHTLC.from(
        aliceBitcoinWallet,
        secretHash,
        alicePubkey,
        bobPubkey,
        expiry
      );

      // Alice initiates in Bitcoin
      await aliceBitcoinHTLC.initiate(fromAmount);

      // Bob intiates in Starknet
      const { low, high } = cairo.uint256(parseEther("10"));
      await bob.execute({
        contractAddress: starknetHTLC.address,
        entrypoint: "initiate",
        calldata: [
          alice.address,
          TIMELOCK,
          low,
          high,
          ...hexToU32Array(secretHash).map(BigInt),
        ],
      });

      // Alice redeems on starknet
      const starknetOrderId = generateOrderId(
        CHAIN_ID,
        bob.address,
        alice.address,
        TIMELOCK,
        AMOUNT,
        hexToU32Array(secretHash)
      );
      const aliceBlanceBeforeRedeem = await stark.balanceOf(alice.address);
      await charlie.execute({
        contractAddress: starknetHTLC.address,
        entrypoint: "redeem",
        calldata: {
          orderId: starknetOrderId,
          secret: hexToU32Array(secret.toString("hex")).map(BigInt),
        },
      });
      const aliceBlanceAfterRedeem = await stark.balanceOf(alice.address);
      expect(aliceBlanceBeforeRedeem + parseEther("10")).toBe(
        aliceBlanceAfterRedeem
      );

      // Bob redeems on Bitcoin
      const bobHTLC = await BitcoinHTLC.from(
        bobBitcoinWallet,
        secretHash,
        alicePubkey,
        bobPubkey,
        expiry
      );
      const redeemId = await bobHTLC.redeem(secret.toString("hex"));
      const tx = await BTCProvider.getTransaction(redeemId);

      // make sure bob received the BTC
      expect(tx).toBeTruthy();
      expect(tx.txid).toBe(redeemId);
      expect(tx.vout[0].scriptpubkey_address).toBe(
        await bobBitcoinWallet.getAddress()
      );
    }, 10000);
  });
});
