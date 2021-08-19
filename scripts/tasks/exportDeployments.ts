import fs from "fs";
import path from "path";
import { promisify } from "util";
import stringify from "json-stable-stringify";

const main = async () => {
  const readdir = promisify(fs.readdir);
  const deploymentsDir = path.resolve(
    path.join(__dirname, "..", "..", "deployments")
  );
  const deploymentsSummary = path.resolve(
    path.join(__dirname, "..", "..", "constants", "deployments.json")
  );

  let networks = await readdir(deploymentsDir);
  networks = networks.filter((n) => !n.startsWith(".")); // filter out hidden files

  const excludeFiles = ["solcInputs"];
  let deployments: { [key: string]: { [key: string]: string } } = {};

  for (const network of networks) {
    deployments[network] = {};

    const networkDir = path.join(deploymentsDir, network);
    let files = await readdir(networkDir);
    const deploymentJSONs = files.filter(
      (f) =>
        !excludeFiles.includes(f) && !f.startsWith(".") && f.endsWith(".json")
    );

    for (const jsonFileName of deploymentJSONs) {
      const jsonPath = path.join(networkDir, jsonFileName);
      const deployData = JSON.parse(
        (await promisify(fs.readFile)(jsonPath)).toString()
      );
      const deployName = jsonFileName.split(".json")[0];
      deployments[network][deployName] = deployData.address;
    }
  }

  await promisify(fs.writeFile)(
    deploymentsSummary,
    stringify(deployments, { space: 4 }) + "\n"
  );
  console.log(`Updated deployments at ${deploymentsSummary}`);
};

export default main;
