import {
  Account,
  cairo,
  CallData,
  Contract,
  RpcProvider,
  stark as sn,
} from "starknet";
import { generateOrderId, getCompiledCode, hexToU32Array } from "./utils";
import { parseEther, sha256 } from "ethers";
import { randomBytes } from "crypto";
import {
  ALICE_ADDRESS,
  ALICE_PRIVATE_KEY,
  STARKNET_DEVNET_URL,
} from "./config";

describe("UDA Address Prediction Test", () => {
  const starknetProvider = new RpcProvider({
    nodeUrl: STARKNET_DEVNET_URL,
  });

  const alice = new Account({
    provider: starknetProvider,
    address: ALICE_ADDRESS,
    signer: ALICE_PRIVATE_KEY,
  });

  const STARK =
    "0x4718F5A0FC34CC1AF16A1CDEE98FFB20C31F5CD61D6AB07201858F4287C938D";
  const ZERO_ADDRESS =
    "0x000000000000000000000000000000000000000000000000000000000000000";
  const TIMELOCK = 1000n;
  const AMOUNT = parseEther("0.1");
  const { low: amountLow, high: amountHigh } = cairo.uint256(AMOUNT);
  const RECEIVER_ADDRESS =
    "0x056b3ebec13503cb1e1d9691f13fdc9b4ae7015765113345a7355add1e29d7dc";

  let stark: Contract;
  let starknetHTLC: Contract;
  let registry: Contract;
  let udaClassHash: string;
  let callData: CallData;
  let secretHash: number[];

  const deployHTLC = async (): Promise<void> => {
    try {
      const { sierraCode, casmCode } = await getCompiledCode(
        "starknet_htlc_HTLC"
      );
      callData = new CallData(sierraCode.abi);

      const constructor = callData.compile("constructor", { token: STARK });

      const deployResponse = await alice.declareAndDeploy({
        contract: sierraCode,
        casm: casmCode,
        constructorCalldata: constructor,
        salt: sn.randomAddress(),
      });

      starknetHTLC = new Contract({
        abi: sierraCode.abi,
        address: deployResponse.deploy.contract_address,
        providerOrAccount: alice,
      });
    } catch (error) {
      console.error("❌ Failed to deploy HTLC:", error);
      throw error;
    }
  };

  // const declareUDA = async (): Promise<string> => {
  //   try {
  //     const { sierraCode, casmCode } = await getCompiledCode(
  //       "starknet_htlc_UniqueDepositAddress"
  //     );

  //     const declareResponse = await alice.declare({
  //       contract: sierraCode,
  //       casm: casmCode,
  //     });

  //     return declareResponse.class_hash;
  //   } catch (error) {
  //     console.error("❌ Failed to declare UDA:", error);
  //     throw error;
  //   }
  // };

  const deployRegistry = async (): Promise<void> => {
    try {
      const { sierraCode, casmCode } = await getCompiledCode(
        "starknet_htlc_registry"
      );
      callData = new CallData(sierraCode.abi);

      const constructor = callData.compile("constructor", {
        owner: alice.address,
        classHash: udaClassHash,
      });

      const deployResponse = await alice.declareAndDeploy({
        contract: sierraCode,
        casm: casmCode,
        constructorCalldata: constructor,
        salt: sn.randomAddress(),
      });

      registry = new Contract({
        abi: sierraCode.abi,
        address: deployResponse.deploy.contract_address,
        providerOrAccount: alice,
      });
    } catch (error) {
      console.error("❌ Failed to deploy Registry:", error);
      throw error;
    }
  };

  const configureRegistry = async (): Promise<void> => {
    try {
      console.log("🔧 Configuring registry...");

      const addHtlcResponse = await alice.execute({
        contractAddress: registry.address,
        entrypoint: "add_htlc",
        calldata: [starknetHTLC.address, STARK],
      });

      await starknetProvider.waitForTransaction(
        addHtlcResponse.transaction_hash
      );

      console.log("✅ Registry configured successfully");
    } catch (error) {
      console.error("❌ Failed to configure registry:", error);
      throw error;
    }
  };

  beforeAll(async () => {
    try {
      // Generate secret and hash
      const secret = sha256(randomBytes(32));
      secretHash = hexToU32Array(sha256(secret));

      // Initialize STARK contract
      const contractData = await starknetProvider.getClassAt(STARK);
      stark = new Contract({
        abi: contractData.abi,
        address: STARK,
        providerOrAccount: starknetProvider,
      });

      console.log("📦 Deploying contracts...");

      await deployHTLC();
      console.log("✅ HTLC deployed at:", starknetHTLC.address);
      await new Promise((resolve) => setTimeout(resolve, 10000));

      udaClassHash =
        "0x0012ab1805f94af93a56cc9ff9bd7341865a0ef265764f081295686c74003f3d";
      console.log("✅ UDA class hash:", udaClassHash);
      await new Promise((resolve) => setTimeout(resolve, 10000));

      await deployRegistry();
      console.log("✅ Registry deployed at:", registry.address);
      await new Promise((resolve) => setTimeout(resolve, 10000));

      await configureRegistry();
      await new Promise((resolve) => setTimeout(resolve, 10000));

      console.log("🔍 Debug Info:");
      console.log("HTLC:", starknetHTLC.address);
      console.log("Registry:", registry.address);
      console.log("UDA Class Hash:", udaClassHash);
    } catch (error) {
      console.error("❌ Setup failed:", error);
      throw error;
    }
  }, 600000);

  describe("- UDA Address Prediction -", () => {
    it("Should predict same address for same parameters", async () => {
      const destinationData: number[] = [];

      const address1 = await registry.get_address(
        STARK,
        alice.address,
        RECEIVER_ADDRESS,
        TIMELOCK,
        secretHash,
        cairo.uint256(AMOUNT),
        destinationData
      );

      const address2 = await registry.get_address(
        STARK,
        alice.address,
        RECEIVER_ADDRESS,
        TIMELOCK,
        secretHash,
        cairo.uint256(AMOUNT),
        destinationData
      );

      console.log("🎯 Predicted address 1:", address1);
      console.log("🎯 Predicted address 2:", address2);

      expect(address1).toBe(address2);
      expect(address1).not.toBe(ZERO_ADDRESS);
      console.log("✅ Address prediction is deterministic");
    }, 30000);

    it("Should predict different addresses for different parameters", async () => {
      const destinationData1: number[] = [];
      const destinationData2: number[] = [1, 2, 3];

      const address1 = await registry.get_address(
        STARK,
        alice.address,
        RECEIVER_ADDRESS,
        TIMELOCK,
        secretHash,
        cairo.uint256(AMOUNT),
        destinationData1
      );

      const address2 = await registry.get_address(
        STARK,
        alice.address,
        RECEIVER_ADDRESS,
        TIMELOCK,
        secretHash,
        cairo.uint256(AMOUNT),
        destinationData2
      );

      console.log("🎯 Address with empty data:", address1);
      console.log("🎯 Address with data [1,2,3]:", address2);

      expect(address1).not.toBe(address2);
      expect(address1).not.toBe(ZERO_ADDRESS);
      expect(address2).not.toBe(ZERO_ADDRESS);
      console.log("✅ Different parameters produce different addresses");
    }, 30000);
  });

  describe("- UDA Creation Test -", () => {
    it("Should match prediction with actual deployment", async () => {
      const destinationData: number[] = [];

      const predictedAddress = await registry.get_address(
        STARK,
        alice.address,
        RECEIVER_ADDRESS,
        TIMELOCK,
        secretHash,
        cairo.uint256(AMOUNT),
        destinationData
      );

      console.log("🔮 Predicted address:", predictedAddress);
      expect(predictedAddress).not.toBe(ZERO_ADDRESS);

      const transferResponse = await alice.execute({
        contractAddress: stark.address,
        entrypoint: "transfer",
        calldata: [predictedAddress, amountLow, amountHigh],
      });

      await starknetProvider.waitForTransaction(
        transferResponse.transaction_hash
      );
      console.log("✅ Transfer completed");

      await alice.waitForBlock(2);
      await new Promise((resolve) => setTimeout(resolve, 10 * 1000));

      console.log("🔮 Creating swap address...");

      try {
        const createSwapResponse = await alice.execute({
          contractAddress: registry.address,
          entrypoint: "create_swap_address",
          calldata: [
            STARK,
            alice.address,
            RECEIVER_ADDRESS,
            TIMELOCK,
            ...secretHash,
            amountLow,
            amountHigh,
            destinationData.length,
            ...destinationData,
          ],
        });

        await starknetProvider.waitForTransaction(
          createSwapResponse.transaction_hash
        );

        const receipt = await starknetProvider.getTransactionReceipt(
          createSwapResponse.transaction_hash
        );

        // @ts-ignore
        const actualAddress = receipt.events?.[0]?.data?.[0];
        const actualAddressHex = "0x" + BigInt(actualAddress).toString(16);
        const predictedAddressHex =
          "0x" + BigInt(predictedAddress).toString(16);

        console.log("🔮 Actual deployed address (hex):", actualAddressHex);
        console.log("🔮 Predicted address (hex):", predictedAddressHex);

        expect(actualAddress).not.toBe(ZERO_ADDRESS);
        expect(actualAddressHex).toBe(predictedAddressHex);
        console.log("✅ Prediction matches actual deployment");
      } catch (error) {
        console.error("❌ UDA deployment failed:", error);
        throw error;
      }
    }, 6000000);

    it("Should validate HTLC integration after UDA deployment", async () => {
      const htlcAddress = await registry.get_htlc_for_token(STARK);
      console.log("📋 HTLC address for STARK:", htlcAddress);

      const htlcAddressHex = "0x" + BigInt(htlcAddress).toString(16);
      expect(htlcAddressHex).toBe(starknetHTLC.address);
      expect(htlcAddress).not.toBe(ZERO_ADDRESS);

      console.log("✅ HTLC integration verified");
    }, 60000);
  });

  describe("- Real World Scenario Test -", () => {
    it("Should test complete flow with order ID generation", async () => {
      const destinationData: number[] = [10, 20, 30];

      // Verify registry has correct HTLC
      const registryHTLC = await registry.get_htlc_for_token(STARK);
      const registryHTLCHex = "0x" + BigInt(registryHTLC).toString(16);
      expect(registryHTLCHex).toBe(starknetHTLC.address);
      console.log("✅ Registry HTLC verified");

      // Test address prediction
      const predictedUDA1 = await registry.get_address(
        STARK,
        alice.address,
        RECEIVER_ADDRESS,
        TIMELOCK,
        secretHash,
        cairo.uint256(AMOUNT),
        destinationData
      );

      const predictedUDA2 = await registry.get_address(
        STARK,
        alice.address,
        RECEIVER_ADDRESS,
        TIMELOCK,
        secretHash,
        cairo.uint256(AMOUNT),
        destinationData
      );

      expect(predictedUDA1).toBe(predictedUDA2);
      expect(predictedUDA1).not.toBe(ZERO_ADDRESS);
      console.log("🎯 Consistent UDA prediction:", predictedUDA1);

      const chainId = (await starknetProvider.getChainId()).toString();
      const orderId = generateOrderId(
        chainId,
        secretHash,
        alice.address,
        RECEIVER_ADDRESS,
        TIMELOCK,
        AMOUNT,
        starknetHTLC.address
      );

      console.log("📋 Generated order ID:", orderId);
      expect(orderId).toBeDefined();
      console.log("✅ Complete flow validation successful");
    }, 30000);
  });

  afterAll(async () => {
    console.log("Test Completed");
  });
});
