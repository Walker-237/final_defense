import { describe, it, expect } from 'vitest';
import { analyser, associerColonnes, normaliserEntete } from './base-clients-parser';

/** En-têtes réels du fichier « BASE CLIENTS ». */
const ENTETES = [
  'NOM ET PRENOM', 'NUMERO DE COMPTE', 'AGENCE', 'MATRICULE', 'CATEGORIE',
  'COMPTE DEPOT', 'ASUJETTI TAXES', 'LOCALISATION', 'DIRIGEANT',
  'TELEPHONE', 'TELEPHONE', 'EMAIL',
];

/** Lignes réelles, recopiées du fichier (agence 5 + compte 11 + clé 2 = 18 chiffres). */
const CERCLE = ['CERCLE DES AMIS SOLIDAIRES', '00001 38100090004 88', '00001', '3810009',
  'Personnes physiques', 'CCEICMCXX000', 'OUI', 'DOUALA', 'Messieurs', '222223437', '', ''];
const AFB = ['AFB', '00090 56010090000 48', '00090', '5601009',
  'Entreprises non financières', '8101/sX1/s', 'OUI', 'YAOUNDE',
  'Monsieur le Directeur Général', '222223437', '', ''];
const AFRILAND_BOURSE = ['AFRILAND BOURSE ET INVESTISSEMENT', '00001 06104291001 79', '00001',
  '0610429', 'Investisseurs institutionnels', 'CCEICMCXX004', 'OUI', 'YAOUNDE',
  'Monsieur le Directeur Général', '222233068', '698191974', ''];

describe('normaliserEntete', () => {
  it('retire accents, casse et espaces superflus', () => {
    expect(normaliserEntete('  NUMÉRO  DE   COMPTE ')).toBe('numero de compte');
  });
});

describe('associerColonnes', () => {
  it('reconnaît les colonnes du fichier réel', () => {
    const map = associerColonnes(ENTETES);
    expect(map.nomPrenom).toBe(0);
    expect(map.numeroCompte).toBe(1);
    expect(map.compteDepot).toBe(5);
    expect(map.email).toBe(11);
  });

  /** Le fichier porte DEUX colonnes « TELEPHONE » : la 2ᵉ ne doit pas écraser la 1ʳᵉ. */
  it('distingue les deux colonnes TELEPHONE', () => {
    const map = associerColonnes(ENTETES);
    expect(map.telephone1).toBe(9);
    expect(map.telephone2).toBe(10);
  });

  it('supporte des colonnes déplacées', () => {
    const map = associerColonnes(['AGENCE', 'NOM ET PRENOM', 'NUMERO DE COMPTE']);
    expect(map.agence).toBe(0);
    expect(map.nomPrenom).toBe(1);
    expect(map.numeroCompte).toBe(2);
  });
});

describe('analyser', () => {
  it('lit une ligne réelle et retire les espaces du numéro', () => {
    const { lignes, rejets } = analyser(ENTETES, [AFB]);
    expect(rejets).toHaveLength(0);
    expect(lignes).toHaveLength(1);
    expect(lignes[0].numeroCompte).toBe('000905601009000048');   // 18 chiffres
    expect(lignes[0].numeroCompte).toHaveLength(18);
    expect(lignes[0].nomPrenom).toBe('AFB');
    expect(lignes[0].agence).toBe('00090');
    expect(lignes[0].categorie).toBe('Entreprises non financières');
  });

  it('récupère le compte de dépôt et les deux téléphones', () => {
    const { lignes } = analyser(ENTETES, [AFRILAND_BOURSE]);
    expect(lignes[0].compteDepot).toBe('CCEICMCXX004');
    expect(lignes[0].telephone1).toBe('222233068');
    expect(lignes[0].telephone2).toBe('698191974');
  });

  it('déduit l’agence des 5 premiers chiffres si la colonne manque', () => {
    const sansAgence = ['NOM ET PRENOM', 'NUMERO DE COMPTE'];
    const { lignes } = analyser(sansAgence, [['CERCLE', '00001 38100090004 88']]);
    expect(lignes[0].agence).toBe('00001');
  });

  it('lit une deuxième ligne réelle du fichier', () => {
    const { lignes, rejets } = analyser(ENTETES, [CERCLE]);
    expect(rejets).toHaveLength(0);
    expect(lignes[0].numeroCompte).toBe('000013810009000488');
    expect(lignes[0].compteDepot).toBe('CCEICMCXX000');
  });

  /**
   * Le fichier contient des lignes de synthèse sans numéro (« FIRST TRUST ») :
   * les écarter, oui — faire échouer tout l'import, non.
   */
  it('écarte une ligne sans numéro sans faire échouer l’import', () => {
    const firstTrust = ['FIRST TRUST', '', '', '', 'Etablissements de microfinance',
      'CCEICMCXX008', '', '', '', '', '', ''];
    const { lignes, rejets } = analyser(ENTETES, [AFB, firstTrust]);
    expect(lignes).toHaveLength(1);
    // Les valeurs brutes de la ligne écartée sont conservées pour ré-export.
    expect(rejets).toEqual([{ ligne: 3, motif: 'numéro de compte absent', valeurs: firstTrust }]);
  });

  it('signale un numéro de mauvaise longueur', () => {
    const court = ['X', '123', '', '', '', '', '', '', '', '', '', ''];
    const { lignes, rejets } = analyser(ENTETES, [court]);
    expect(lignes).toHaveLength(0);
    expect(rejets[0].motif).toContain('3 chiffres');
  });

  it('ignore en silence une ligne entièrement vide', () => {
    const { lignes, rejets } = analyser(ENTETES, [['', '', '', '', '', '', '', '', '', '', '', '']]);
    expect(lignes).toHaveLength(0);
    expect(rejets).toHaveLength(0);
  });
});
