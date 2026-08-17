require('dotenv').config();
const hre = require('hardhat');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

/**
 * Lit le "tip" actuel de la chaine de hash directement dans Postgres (même
 * base que le backend Spring — cf. audit_chain_state, migration V27), le
 * publie sur la blockchain via AuditAnchor.anchor(), puis enregistre le
 * résultat (tx hash, bloc, réseau) dans audit_chain_anchors pour que le
 * back-office puisse l'afficher. Ce script ne modifie AUCUN code de
 * l'application Spring : il lit/écrit directement en base, en dehors d'elle.
 */
async function main() {
  const deploymentsPath = path.join(__dirname, '..', 'deployments.json');
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error("Aucun déploiement trouvé. Lancez d'abord `npm run deploy:local` (ou :sepolia).");
  }
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'));
  const address = deployments[hre.network.name];
  if (!address) {
    throw new Error(`Aucune adresse de contrat pour le réseau "${hre.network.name}" dans deployments.json.`);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL manquant (cf. .env.example) — même base que le backend Spring.');
  }

  const pg = new Client({ connectionString: databaseUrl });
  await pg.connect();
  try {
    const { rows } = await pg.query('SELECT tip_hash, entry_count FROM audit_chain_state WHERE id = 1');
    if (rows.length === 0) {
      throw new Error('Table audit_chain_state vide — la migration V27 a-t-elle été appliquée ?');
    }
    const { tip_hash: tipHash, entry_count: entryCount } = rows[0];
    console.log(`Tip actuel : ${tipHash} (${entryCount} entrées)`);

    const AuditAnchor = await hre.ethers.getContractFactory('AuditAnchor');
    const contract = AuditAnchor.attach(address);

    const tipHashBytes32 = '0x' + tipHash;
    const tx = await contract.anchor(tipHashBytes32, BigInt(entryCount));
    console.log(`Transaction envoyée : ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`Confirmée au bloc ${receipt.blockNumber}.`);

    await pg.query(
      `INSERT INTO audit_chain_anchors (tip_hash, entry_count, tx_hash, network, contract_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [tipHash, entryCount, tx.hash, hre.network.name, address],
    );
    console.log('Ancrage enregistré dans audit_chain_anchors — visible au back-office.');

    if (hre.network.name === 'sepolia') {
      console.log(`Explorateur public : https://sepolia.etherscan.io/tx/${tx.hash}`);
    }
  } finally {
    await pg.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
