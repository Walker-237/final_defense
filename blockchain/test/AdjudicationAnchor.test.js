const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('AdjudicationAnchor', function () {
  async function deploy() {
    const [owner, autre] = await ethers.getSigners();
    const AdjudicationAnchor = await ethers.getContractFactory('AdjudicationAnchor');
    const contract = await AdjudicationAnchor.deploy();
    await contract.waitForDeployment();
    return { contract, owner, autre };
  }

  function emissionId(seed) {
    return ethers.zeroPadValue(ethers.toBeHex(seed), 32);
  }

  it('refuse une publication venant de quelqu’un d’autre que le propriétaire', async function () {
    const { contract, autre } = await deploy();
    const hash = ethers.keccak256(ethers.toUtf8Bytes('resultat-1'));
    await expect(contract.connect(autre).anchorResult(emissionId(1), hash)).to.be.revertedWith(
      'AdjudicationAnchor: appelant non autorise',
    );
  });

  it('publie un résultat et émet ResultatAncre', async function () {
    const { contract } = await deploy();
    const id = emissionId(1);
    const hash = ethers.keccak256(ethers.toUtf8Bytes('resultat-1'));

    await expect(contract.anchorResult(id, hash)).to.emit(contract, 'ResultatAncre');

    const [resultHash, , existe] = await contract.getResult(id);
    expect(resultHash).to.equal(hash);
    expect(existe).to.equal(true);
    expect(await contract.count()).to.equal(1n);
  });

  it("refuse de republier un resultat pour la MEME emission — c'est precisement ce que ce mecanisme doit empecher", async function () {
    const { contract } = await deploy();
    const id = emissionId(1);
    const hash1 = ethers.keccak256(ethers.toUtf8Bytes('resultat-original'));
    const hash2 = ethers.keccak256(ethers.toUtf8Bytes('resultat-truque'));

    await contract.anchorResult(id, hash1);

    await expect(contract.anchorResult(id, hash2)).to.be.revertedWith(
      'AdjudicationAnchor: deja ancre pour cette emission',
    );
    // Le resultat original reste inchange.
    const [resultHash] = await contract.getResult(id);
    expect(resultHash).to.equal(hash1);
  });

  it('permet de publier des résultats pour PLUSIEURS émissions distinctes', async function () {
    const { contract } = await deploy();
    const id1 = emissionId(1);
    const id2 = emissionId(2);
    const hash1 = ethers.keccak256(ethers.toUtf8Bytes('resultat-emission-1'));
    const hash2 = ethers.keccak256(ethers.toUtf8Bytes('resultat-emission-2'));

    await contract.anchorResult(id1, hash1);
    await contract.anchorResult(id2, hash2);

    expect(await contract.count()).to.equal(2n);
    const [h1] = await contract.getResult(id1);
    const [h2] = await contract.getResult(id2);
    expect(h1).to.equal(hash1);
    expect(h2).to.equal(hash2);
  });

  it('renvoie existe=false pour une émission jamais ancrée', async function () {
    const { contract } = await deploy();
    const [, , existe] = await contract.getResult(emissionId(99));
    expect(existe).to.equal(false);
  });
});
