const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('AuditAnchor', function () {
  async function deploy() {
    const [owner, autre] = await ethers.getSigners();
    const AuditAnchor = await ethers.getContractFactory('AuditAnchor');
    const contract = await AuditAnchor.deploy();
    await contract.waitForDeployment();
    return { contract, owner, autre };
  }

  it("fixe le déployeur comme propriétaire", async function () {
    const { contract, owner } = await deploy();
    expect(await contract.owner()).to.equal(owner.address);
  });

  it('refuse un ancrage venant de quelqu’un d’autre que le propriétaire', async function () {
    const { contract, autre } = await deploy();
    const hash = ethers.keccak256(ethers.toUtf8Bytes('faux-tip'));
    await expect(contract.connect(autre).anchor(hash, 1)).to.be.revertedWith(
      'AuditAnchor: appelant non autorise',
    );
  });

  it('enregistre un ancrage et émet Anchored', async function () {
    const { contract } = await deploy();
    const hash = ethers.keccak256(ethers.toUtf8Bytes('tip-1'));

    await expect(contract.anchor(hash, 3))
      .to.emit(contract, 'Anchored')
      .withArgs(0n, hash, 3n, await lastBlockTimestamp());

    expect(await contract.anchorCount()).to.equal(1n);
    const [tipHash, entryCount] = await contract.latestAnchor();
    expect(tipHash).to.equal(hash);
    expect(entryCount).to.equal(3n);
  });

  it('empile plusieurs ancrages successifs sans écraser les précédents', async function () {
    const { contract } = await deploy();
    const hash1 = ethers.keccak256(ethers.toUtf8Bytes('tip-1'));
    const hash2 = ethers.keccak256(ethers.toUtf8Bytes('tip-2'));

    await contract.anchor(hash1, 1);
    await contract.anchor(hash2, 2);

    expect(await contract.anchorCount()).to.equal(2n);
    const [premierHash] = await contract.getAnchor(0);
    expect(premierHash).to.equal(hash1);
    const [dernierHash, dernierCount] = await contract.latestAnchor();
    expect(dernierHash).to.equal(hash2);
    expect(dernierCount).to.equal(2n);
  });

  it("transfère la propriété et empêche l'ancien propriétaire d'ancrer ensuite", async function () {
    const { contract, autre } = await deploy();
    await contract.transferOwnership(autre.address);
    expect(await contract.owner()).to.equal(autre.address);

    const hash = ethers.keccak256(ethers.toUtf8Bytes('tip-x'));
    await expect(contract.anchor(hash, 1)).to.be.revertedWith('AuditAnchor: appelant non autorise');
    await expect(contract.connect(autre).anchor(hash, 1)).to.not.be.reverted;
  });

  async function lastBlockTimestamp() {
    const block = await ethers.provider.getBlock('latest');
    return block.timestamp + 1; // le bloc de la TX suivante avance d'au moins 1s sur Hardhat
  }
});
