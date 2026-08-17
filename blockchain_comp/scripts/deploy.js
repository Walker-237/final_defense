const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const AuditAnchor = await hre.ethers.getContractFactory('AuditAnchor');
  const contract = await AuditAnchor.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log(`AuditAnchor déployé à l'adresse : ${address}`);
  console.log(`Réseau : ${hre.network.name}`);

  const deploymentsPath = path.join(__dirname, '..', 'deployments.json');
  const deployments = fs.existsSync(deploymentsPath)
    ? JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'))
    : {};
  deployments[hre.network.name] = address;
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log(`Adresse enregistrée dans deployments.json (${hre.network.name}).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
