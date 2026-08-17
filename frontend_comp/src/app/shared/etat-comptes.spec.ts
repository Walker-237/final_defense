import { describe, it, expect } from 'vitest';
import {
  COMPTE_NON_RENSEIGNE,
  afficherCompte,
  classeEtatComptes,
  estRenseigne,
  etatComptes,
} from './etat-comptes';

describe('estRenseigne', () => {
  it('accepte un numéro non vide', () => {
    expect(estRenseigne('037 10001 00000012345')).toBe(true);
  });

  it.each([null, undefined, '', '   '])('refuse %p', (v) => {
    expect(estRenseigne(v as string | null | undefined)).toBe(false);
  });
});

describe('etatComptes', () => {
  it('est COMPLET quand les deux comptes sont renseignés', () => {
    expect(etatComptes('037 10001 00000012345', '1000500010000004320768')).toBe('COMPLET');
  });

  /** Cas nominal de l'auto-inscription : espèces saisi, titres pas encore attribué. */
  it('est INCOMPLET sans compte-titres, même avec un compte espèces', () => {
    expect(etatComptes(null, '1000500010000004320768')).toBe('INCOMPLET');
  });

  it('est INCOMPLET sans compte espèces', () => {
    expect(etatComptes('037 10001 00000012345', null)).toBe('INCOMPLET');
  });

  it('est INCOMPLET quand les deux manquent', () => {
    expect(etatComptes(undefined, undefined)).toBe('INCOMPLET');
  });

  it('ne se laisse pas berner par des espaces', () => {
    expect(etatComptes('   ', '1000500010000004320768')).toBe('INCOMPLET');
  });
});

describe('classeEtatComptes', () => {
  it('est verte quand tout est renseigné', () => {
    expect(classeEtatComptes('037 10001 00000012345', '1000500010000004320768'))
      .toContain('green');
  });

  it('est rouge dès qu’un compte manque', () => {
    expect(classeEtatComptes(null, '1000500010000004320768')).toContain('red');
  });
});

describe('afficherCompte', () => {
  it('rend le numéro tel quel', () => {
    expect(afficherCompte(' 037 10001 00000012345 ')).toBe('037 10001 00000012345');
  });

  it('signale un compte manquant', () => {
    expect(afficherCompte(null)).toBe(COMPTE_NON_RENSEIGNE);
  });
});
