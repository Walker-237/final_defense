const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

/**
 * Déploie les deux contrats d'ancrage :
 *  - AuditAnchor        : "tip" du chaînage du journal d'audit (avance en continu)
 *  - AdjudicationAnchor : un résultat figé par émission (publié une seule fois)
 *
 * deployments.json (par réseau) :
 * { "localhost": { "auditAnchor": "0x...", "adjudicationAnchor": "0x..." } }
 */
async function deployContract(name) {
  const Factory = await hre.ethers.getContractFactory(name);
  const contract = await Factory.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`${name} déployé à l'adresse : ${address}`);
  return address;
}

async function main() {
  console.log(`Réseau : ${hre.network.name}`);

  const auditAnchor = await deployContract('AuditAnchor');
  const adjudicationAnchor = await deployContract('AdjudicationAnchor');

  const deploymentsPath = path.join(__dirname, '..', 'deployments.json');
  const deployments = fs.existsSync(deploymentsPath)
    ? JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'))
    : {};
  deployments[hre.network.name] = { auditAnchor, adjudicationAnchor };
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log(`Adresses enregistrées dans deployments.json (${hre.network.name}).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
