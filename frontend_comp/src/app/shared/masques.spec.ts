import { describe, it, expect } from 'vitest';
import {
  formaterCompte, compteComplet, chiffres,
  formaterTelephone, telephoneComplet, telephoneNational, telephoneInternational,
} from './masques';

describe('Masque du compte espèces', () => {
  // Ligne réelle de la base clients : « 00090 56010090000 48 » (18 chiffres),
  // que le code banque 10005 préfixe pour former le RIB de 23 chiffres.
  const RIB = '10005000905601009000048';
  const AFFICHE = '10005 00090 56010090000 48';

  it('préremplit le préfixe imposé 10005', () => {
    expect(formaterCompte('')).toBe('10005');
  });

  it('impose le préfixe même si l’utilisateur tape autre chose', () => {
    expect(formaterCompte('9')).toBe('10005 9');
  });

  it('groupe la saisie 5-5-11-2 (banque, agence, compte, clé)', () => {
    expect(formaterCompte(RIB)).toBe(AFFICHE);
  });

  it('VERROUILLE la saisie à 23 chiffres (la frappe en trop est ignorée)', () => {
    const complet = formaterCompte(RIB);
    // L'utilisateur continue de taper : rien de plus ne s'inscrit.
    expect(formaterCompte(complet + '999')).toBe(complet);
    expect(chiffres(formaterCompte(complet + '999'))).toHaveLength(23);
  });

  it('ignore les caractères non numériques', () => {
    expect(formaterCompte('10005abc00090')).toBe('10005 00090');
  });

  it('tolère un collage contenant déjà le préfixe et les espaces', () => {
    expect(formaterCompte(AFFICHE)).toBe(AFFICHE);
  });

  it('compteComplet() n’est vrai qu’à 23 chiffres', () => {
    expect(compteComplet('10005 00090')).toBe(false);
    expect(compteComplet(AFFICHE)).toBe(true);
  });
});

describe('Masque du téléphone', () => {
  it('préremplit l’indicatif +237', () => {
    expect(formaterTelephone('')).toBe('+237 ');
  });

  it('formate le numéro national en groupes', () => {
    expect(formaterTelephone('694216755')).toBe('+237 694 21 67 55');
  });

  it('VERROUILLE à 9 chiffres après l’indicatif', () => {
    const complet = formaterTelephone('694216755');
    expect(formaterTelephone(complet + '99')).toBe(complet);
    expect(telephoneNational(formaterTelephone(complet + '99'))).toHaveLength(9);
  });

  it('absorbe un collage au format international', () => {
    expect(formaterTelephone('+237694216755')).toBe('+237 694 21 67 55');
    expect(formaterTelephone('237694216755')).toBe('+237 694 21 67 55');
  });

  it('ne duplique jamais l’indicatif', () => {
    expect(formaterTelephone('+237 +237 694216755')).toBe('+237 694 21 67 55');
  });

  it('la frappe après le préfixe ne ré-absorbe pas l’indicatif (régression)', () => {
    // Le champ contient déjà « +237 » ; chaque touche ne doit PAS réintroduire « 237 »
    // dans le numéro national (bug : « +237 6 » devenait « +237 237 6 »).
    expect(formaterTelephone('+237 6')).toBe('+237 6');
    expect(formaterTelephone('+237 69')).toBe('+237 69');
    expect(formaterTelephone('+237 694')).toBe('+237 694');
    expect(formaterTelephone('+237 6942')).toBe('+237 694 2');
    expect(telephoneNational('+237 694216755')).toBe('694216755');
  });

  it('telephoneComplet() exige les 9 chiffres', () => {
    expect(telephoneComplet('+237 694 21')).toBe(false);
    expect(telephoneComplet('+237 694 21 67 55')).toBe(true);
  });

  it('expose les formes attendues par le backend', () => {
    expect(telephoneNational('+237 694 21 67 55')).toBe('694216755');
    expect(telephoneInternational('+237 694 21 67 55')).toBe('+237694216755');
    expect(telephoneInternational('')).toBe('');
  });
});
