// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AuditAnchor
/// @notice Ancre periodiquement le "tip" (dernier hash) de la chaine de hash
/// du journal d'audit Afriland First Bond (cf. AuditService.java, backend).
/// Une fois publie ici, un hash ne peut plus etre reecrit : toute
/// modification retroactive du journal — meme faite directement en base,
/// hors application — devient detectable en comparant le hash recalcule a
/// celui enregistre ici au moment de l'ancrage. C'est le point de controle
/// qu'un attaquant ayant un acces total a la base ne peut pas effacer.
contract AuditAnchor {
    address public owner;

    struct Anchor {
        bytes32 tipHash;
        uint64 entryCount;
        uint256 timestamp;
    }

    Anchor[] private anchors;

    event Anchored(uint256 indexed index, bytes32 tipHash, uint64 entryCount, uint256 timestamp);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "AuditAnchor: appelant non autorise");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Enregistre un nouvel ancrage. Reserve au proprietaire (la cle
    /// de service du backend) — sans cette restriction, n'importe qui
    /// pourrait publier un faux "tip" et rendre la verification inutilisable.
    function anchor(bytes32 tipHash, uint64 entryCount) external onlyOwner {
        anchors.push(Anchor(tipHash, entryCount, block.timestamp));
        emit Anchored(anchors.length - 1, tipHash, entryCount, block.timestamp);
    }

    function anchorCount() external view returns (uint256) {
        return anchors.length;
    }

    function getAnchor(uint256 index)
        external
        view
        returns (bytes32 tipHash, uint64 entryCount, uint256 timestamp)
    {
        Anchor storage a = anchors[index];
        return (a.tipHash, a.entryCount, a.timestamp);
    }

    function latestAnchor() external view returns (bytes32 tipHash, uint64 entryCount, uint256 timestamp) {
        require(anchors.length > 0, "AuditAnchor: aucun ancrage");
        Anchor storage a = anchors[anchors.length - 1];
        return (a.tipHash, a.entryCount, a.timestamp);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "AuditAnchor: adresse invalide");
        address previous = owner;
        owner = newOwner;
        emit OwnershipTransferred(previous, newOwner);
    }
}
