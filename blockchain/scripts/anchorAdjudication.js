require('dotenv').config();
const hre = require('hardhat');
const { ethers } = require('hardhat');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

/**
 * Ancre tout résultat d'adjudication figé (adjudication_results,
 * cf. AdjudicationResultController.java) qui n'a pas encore d'ancrage
 * on-chain (adjudication_anchors). Un résultat déjà ancré ne l'est jamais une
 * seconde fois — le contrat lui-même le refuserait (AdjudicationAnchor.sol).
 */
async function main() {
  const deploymentsPath = path.join(__dirname, '..', 'deployments.json');
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error("Aucun déploiement trouvé. Lancez d'abord `npm run deploy:local` (ou :sepolia).");
  }
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'));
  const address = deployments[hre.network.name]?.adjudicationAnchor;
  if (!address) {
    throw new Error(`Aucune adresse AdjudicationAnchor pour le réseau "${hre.network.name}".`);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL manquant (cf. .env.example).');
  }

  const pg = new Client({ connectionString: databaseUrl });
  await pg.connect();
  try {
    const { rows } = await pg.query(
      `SELECT r.emission_id, r.result_hash, r.order_count
       FROM adjudication_results r
       LEFT JOIN adjudication_anchors a ON a.emission_id = r.emission_id
       WHERE a.id IS NULL
       ORDER BY r.computed_at`,
    );

    if (rows.length === 0) {
      console.log('Aucun résultat en attente d’ancrage.');
      return;
    }
    console.log(`${rows.length} résultat(s) à ancrer.`);

    const AdjudicationAnchor = await ethers.getContractFactory('AdjudicationAnchor');
    const contract = AdjudicationAnchor.attach(address);

    for (const row of rows) {
      const emissionIdBytes32 = ethers.zeroPadValue('0x' + row.emission_id.replace(/-/g, ''), 32);
      const resultHashBytes32 = '0x' + row.result_hash;

      console.log(`\nÉmission ${row.emission_id} (${row.order_count} ordre(s)) — hash ${row.result_hash}`);
      const tx = await contract.anchorResult(emissionIdBytes32, resultHashBytes32);
      console.log(`Transaction envoyée : ${tx.hash}`);
      await tx.wait();
      console.log('Confirmée.');

      await pg.query(
        `INSERT INTO adjudication_anchors (emission_id, result_hash, tx_hash, network, contract_address)
         VALUES ($1, $2, $3, $4, $5)`,
        [row.emission_id, row.result_hash, tx.hash, hre.network.name, address],
      );

      if (hre.network.name === 'sepolia') {
        console.log(`Explorateur public : https://sepolia.etherscan.io/tx/${tx.hash}`);
      }
    }
    console.log('\nTous les résultats en attente ont été ancrés.');
  } finally {
    await pg.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
