import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  secureRandomInt,
  secureRandomChar,
  secureShuffle,
  generateTemporaryPassword,
  TEMP_PASSWORD_LENGTH,
  MAJUSCULES,
  MINUSCULES,
  CHIFFRES,
  SYMBOLES,
} from './secure-random';

afterEach(() => vi.unstubAllGlobals());

describe('secureRandomInt', () => {
  it('refuse un max non entier ou ≤ 0', () => {
    expect(() => secureRandomInt(0)).toThrow(RangeError);
    expect(() => secureRandomInt(-1)).toThrow(RangeError);
    expect(() => secureRandomInt(2.5)).toThrow(RangeError);
  });

  it('renvoie toujours 0 quand max vaut 1', () => {
    expect(secureRandomInt(1)).toBe(0);
  });

  it('reste dans [0, max) sur un grand nombre de tirages', () => {
    for (let i = 0; i < 500; i++) {
      const v = secureRandomInt(10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
    }
  });

  it('couvre toutes les valeurs possibles (pas de borne morte)', () => {
    const vus = new Set<number>();
    for (let i = 0; i < 400; i++) vus.add(secureRandomInt(4));
    expect(vus).toEqual(new Set([0, 1, 2, 3]));
  });

  it('échoue explicitement quand le CSPRNG est indisponible', () => {
    vi.stubGlobal('crypto', undefined);
    expect(() => secureRandomInt(10)).toThrow(/CSPRNG indisponible/);
  });

  it('n’utilise jamais Math.random()', () => {
    const spy = vi.spyOn(Math, 'random');
    secureRandomInt(10);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('rejette les tirages qui biaiseraient le modulo (rejection sampling)', () => {
    // max = 3 → limite = floor(2^32/3)*3 = 4294967295. La valeur 4294967295
    // doit être rejetée, puis la suivante (0) acceptée.
    const valeurs = [4_294_967_295, 0];
    let i = 0;
    vi.stubGlobal('crypto', {
      getRandomValues: (buf: Uint32Array) => {
        buf[0] = valeurs[i++];
        return buf;
      },
    });
    expect(secureRandomInt(3)).toBe(0);
    expect(i).toBe(2); // le 1er tirage a bien été rejeté
  });
});

describe('secureRandomChar', () => {
  it('renvoie un caractère de l’alphabet fourni', () => {
    for (let i = 0; i < 100; i++) {
      expect(CHIFFRES).toContain(secureRandomChar(CHIFFRES));
    }
  });
});

describe('secureShuffle', () => {
  it('conserve exactement les mêmes éléments', () => {
    const src = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = secureShuffle([...src]);
    expect([...out].sort((a, b) => a - b)).toEqual(src);
  });

  it('gère les tableaux vides et singletons', () => {
    expect(secureShuffle([])).toEqual([]);
    expect(secureShuffle(['x'])).toEqual(['x']);
  });

  it('produit plusieurs permutations distinctes (mélange effectif)', () => {
    const perms = new Set<string>();
    for (let i = 0; i < 60; i++) perms.add(secureShuffle([1, 2, 3, 4, 5]).join(''));
    expect(perms.size).toBeGreaterThan(1);
  });

  it('n’utilise jamais Math.random()', () => {
    const spy = vi.spyOn(Math, 'random');
    secureShuffle([1, 2, 3, 4, 5]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('generateTemporaryPassword', () => {
  it('produit la longueur par défaut', () => {
    expect(generateTemporaryPassword()).toHaveLength(TEMP_PASSWORD_LENGTH);
  });

  it('respecte une longueur explicite', () => {
    expect(generateTemporaryPassword(20)).toHaveLength(20);
  });

  it('refuse une longueur inférieure au nombre de classes requises', () => {
    expect(() => generateTemporaryPassword(3)).toThrow(RangeError);
  });

  it('contient au moins une majuscule, une minuscule, un chiffre et un symbole', () => {
    for (let i = 0; i < 40; i++) {
      const mdp = generateTemporaryPassword();
      expect([...mdp].some((c) => MAJUSCULES.includes(c))).toBe(true);
      expect([...mdp].some((c) => MINUSCULES.includes(c))).toBe(true);
      expect([...mdp].some((c) => CHIFFRES.includes(c))).toBe(true);
      expect([...mdp].some((c) => SYMBOLES.includes(c))).toBe(true);
    }
  });

  it('n’émet que des caractères de l’alphabet autorisé', () => {
    const autorise = MAJUSCULES + MINUSCULES + CHIFFRES + SYMBOLES;
    for (const c of generateTemporaryPassword(40)) {
      expect(autorise).toContain(c);
    }
  });

  it('exclut les caractères ambigus (0, 1, I, L, O, l, o)', () => {
    const mdp = generateTemporaryPassword(60);
    for (const ambigu of ['0', '1', 'I', 'L', 'O', 'l', 'o']) {
      expect(mdp).not.toContain(ambigu);
    }
  });

  it('ne place pas les classes de caractères à position fixe', () => {
    // Sans mélange, le 1er caractère serait toujours une majuscule.
    const premiers = new Set<boolean>();
    for (let i = 0; i < 60; i++) {
      premiers.add(MAJUSCULES.includes(generateTemporaryPassword()[0]));
    }
    expect(premiers.has(false)).toBe(true);
  });

  it('ne produit jamais deux fois le même mot de passe', () => {
    const vus = new Set<string>();
    for (let i = 0; i < 100; i++) vus.add(generateTemporaryPassword());
    expect(vus.size).toBe(100);
  });

  it('n’utilise jamais Math.random()', () => {
    const spy = vi.spyOn(Math, 'random');
    generateTemporaryPassword();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
