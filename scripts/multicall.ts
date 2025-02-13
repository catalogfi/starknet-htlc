import { Account, Contract, RpcProvider, stark } from "starknet";
import * as dotenv from "dotenv";
import { getCompiledCode, writeDeploymentInfo } from "./utils";
dotenv.config();

type NetworkType = "sepolia" | "mainnet" | "devnet";

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    console.error("Usage: ts-node deploy.ts <network> <rpc_url>");
    process.exit(1);
  }

  const [network, rpcUrl] = args;

  if (!["sepolia", "mainnet", "devnet"].includes(network as NetworkType)) {
    console.error(
      `Invalid network. Supported networks: sepolia, mainnet, devnet`
    );
    process.exit(1);
  }

  const provider = new RpcProvider({
    nodeUrl: rpcUrl,
  });

  console.log(`Deploying to ${network}...`);
  console.log(`RPC URL: ${rpcUrl}`);

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const accountAddress = process.env.DEPLOYER_ADDRESS;

  if (!privateKey || !accountAddress) {
    console.error("Missing DEPLOYER_PRIVATE_KEY or DEPLOYER_ADDRESS in .env");
    process.exit(1);
  }

  const account = new Account(provider, accountAddress, privateKey);
  console.log("Account connected:", accountAddress);

  try {
    const { sierraCode, casmCode } = await getCompiledCode(
      "starknet_htlc_Multicall"
    );

    console.log("Declaring and deploying contract...");
    const deployResponse = await account.declareAndDeploy({
      contract: sierraCode,
      casm: casmCode,
      salt: stark.randomAddress(),
    });

    const deployedContract = new Contract(
      sierraCode.abi,
      deployResponse.deploy.contract_address,
      provider
    );

    console.log("✅ Multicall Contract deployed successfully!");
    console.log("Contract address:", deployedContract.address);
    console.log("Transaction hash:", deployResponse.deploy.transaction_hash);

    // Save deployment info
    const deployInfo = {
      network,
      contractAddress: deployedContract.address,
      deploymentHash: deployResponse.deploy.transaction_hash,
      timestamp: new Date().toISOString(),
    };

    await writeDeploymentInfo("multicall", network, deployInfo);
  } catch (error: any) {
    console.error("Deployment failed:", error.message);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
