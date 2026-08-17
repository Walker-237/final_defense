require('@nomicfoundation/hardhat-toolbox');
require('dotenv').config();

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || '';
const SEPOLIA_PRIVATE_KEY = process.env.SEPOLIA_PRIVATE_KEY || '';

/**
 * Reseau par defaut ("hardhat") : ephemere, en memoire, aucune configuration
 * requise — c'est ce que `npx hardhat test` utilise. "localhost" pointe vers
 * un noeud Hardhat persistant lance a part (`npm run node`), pratique pour
 * une demo ou l'etat doit survivre entre le deploiement et l'ancrage.
 * "sepolia" est le seul reseau PUBLIC : il exige une cle privee financee
 * (faucet) et une URL RPC (Infura/Alchemy) — cf. .env.example.
 */
module.exports = {
  solidity: '0.8.24',
  networks: {
    localhost: {
      url: 'http://127.0.0.1:8545',
    },
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: SEPOLIA_PRIVATE_KEY ? [SEPOLIA_PRIVATE_KEY] : [],
    },
  },
};
