import path from "path";
import { promises as fs } from "fs";

export async function getCompiledCode(filename: string) {
  const sierraFilePath = path.join(
    __dirname,
    `../target/dev/${filename}.contract_class.json`
  );
  const casmFilePath = path.join(
    __dirname,
    `../target/dev/${filename}.compiled_contract_class.json`
  );

  const code = [sierraFilePath, casmFilePath].map(async (filePath) => {
    const file = await fs.readFile(filePath);
    return JSON.parse(file.toString("ascii"));
  });

  const [sierraCode, casmCode] = await Promise.all(code);

  return {
    sierraCode,
    casmCode,
  };
}

export async function writeDeploymentInfo(
  contract: "htlc" | "multicall",
  network: string,
  deployInfo: any
) {
  await fs.mkdir("./deployments", { recursive: true });

  const deploymentPath = `./deployments/${contract}_${network}_${deployInfo.contractAddress}.json`;
  try {
    await fs.access(deploymentPath);
    console.log("Deployment file already exists");
  } catch (error) {
    await fs.writeFile(deploymentPath, JSON.stringify(deployInfo, null, 2));
    console.log("Created deployment file:", deploymentPath);
  }
}
