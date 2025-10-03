import { Account, Contract, RpcProvider } from "starknet";
import {
  ALICE_ADDRESS,
  ALICE_PRIVATE_KEY,
  STARKNET_DEVNET_URL,
} from "../tests/config";

async function recoverCustomAddresses() {
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

  // Add your deployed contract addresses here
  const contractsToCheck = [
    "0xa77b8613ea0ef42f091fd9815823d2dc69428747d8abf496d8ab769d218b72",
    "0x01fdf2ed21ca6317db2e5ce9f433b0056731971640cb08db0f13fe9033525e9a",
  ];

  console.log("🔍 Checking custom addresses...");

  const contractData = await starknetProvider.getClassAt(STARK);
  const stark = new Contract({
    abi: contractData.abi,
    address: STARK,
    providerOrAccount: starknetProvider,
  });

  let totalRecovered = 0n;

  for (const contractAddr of contractsToCheck) {
    try {
      const balance = await stark.balanceOf(contractAddr);
      if (balance > 0n) {
        console.log(`💰 Contract ${contractAddr} has ${balance} STARK`);

        // Try to recover funds
        try {
          await alice.execute({
            contractAddress: contractAddr,
            entrypoint: "recover_token",
            calldata: [STARK],
          });
          console.log(`✅ Recovered ${balance} STARK from ${contractAddr}`);
          totalRecovered += balance;
        } catch (error: any) {
          console.log(
            `❌ Could not recover from ${contractAddr}:`,
            error.message
          );
        }
      } else {
        console.log(`💤 Contract ${contractAddr} has 0 STARK`);
      }
    } catch (error: any) {
      console.log(`❌ Could not check ${contractAddr}:`, error.message);
    }
  }

  console.log(`🎉 Total recovered: ${totalRecovered} STARK`);
}

recoverCustomAddresses().catch(console.error);
