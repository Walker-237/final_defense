// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AdjudicationAnchor
/// @notice Publie le hash du resultat d'adjudication d'une emission (montant
/// retenu, taux, volume alloue par ordre — cf. AdjudicationResultController.java,
/// backend), une fois pour toutes. Contrairement a AuditAnchor (un "tip" qui
/// avance en continu), chaque emission a EXACTEMENT un resultat, publie au
/// moment ou un superviseur decide de le figer.
///
/// @dev Un investisseur peut recalculer le hash de son propre resultat
/// d'ordre et le comparer a ce qui est publie ici : la publication est
/// PUBLIQUE et IMMUABLE, aucune partie (y compris la banque elle-meme) ne
/// peut la modifier apres coup.
contract AdjudicationAnchor {
    address public owner;

    struct Resultat {
        bytes32 resultHash;
        uint256 timestamp;
        bool existe;
    }

    mapping(bytes32 => Resultat) private resultats;
    bytes32[] private emissionIds;

    event ResultatAncre(bytes32 indexed emissionId, bytes32 resultHash, uint256 timestamp);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "AdjudicationAnchor: appelant non autorise");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Publie le resultat d'une emission. Impossible de le publier une
    /// seconde fois : republier avec un hash different serait exactement la
    /// reecriture retroactive que ce mecanisme doit exposer, pas permettre.
    function anchorResult(bytes32 emissionId, bytes32 resultHash) external onlyOwner {
        require(!resultats[emissionId].existe, "AdjudicationAnchor: deja ancre pour cette emission");
        resultats[emissionId] = Resultat(resultHash, block.timestamp, true);
        emissionIds.push(emissionId);
        emit ResultatAncre(emissionId, resultHash, block.timestamp);
    }

    function getResult(bytes32 emissionId)
        external
        view
        returns (bytes32 resultHash, uint256 timestamp, bool existe)
    {
        Resultat storage r = resultats[emissionId];
        return (r.resultHash, r.timestamp, r.existe);
    }

    function count() external view returns (uint256) {
        return emissionIds.length;
    }

    function emissionIdAt(uint256 index) external view returns (bytes32) {
        return emissionIds[index];
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "AdjudicationAnchor: adresse invalide");
        address previous = owner;
        owner = newOwner;
        emit OwnershipTransferred(previous, newOwner);
    }
}
