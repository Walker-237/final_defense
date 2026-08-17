/**
 * Aléa cryptographique — utilisé pour les secrets (mots de passe provisoires).
 *
 * `Math.random()` est un générateur pseudo-aléatoire prévisible : il ne doit
 * jamais servir à produire un secret. Ce module s'appuie exclusivement sur la
 * Web Crypto API (`crypto.getRandomValues`), disponible dans tous les
 * navigateurs modernes et dans Node ≥ 19.
 */

/** 2^32 — cardinal de l'espace tiré par `Uint32Array`. */
const UINT32_SPACE = 0x1_0000_0000;

/** Longueur par défaut d'un mot de passe provisoire. */
export const TEMP_PASSWORD_LENGTH = 12;

export const MAJUSCULES = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // sans I, L, O (confusion)
export const MINUSCULES = 'abcdefghijkmnpqrstuvwxyz'; // sans l, o
export const CHIFFRES = '23456789'; // sans 0, 1
export const SYMBOLES = '@#%&*!?';

/**
 * Entier uniforme dans `[0, max)` tiré au sort cryptographiquement.
 *
 * Le simple `valeur % max` biaise les premiers indices lorsque `max` ne divise
 * pas 2^32 : on rejette donc les tirages au-delà du plus grand multiple de
 * `max` inférieur à 2^32 (rejection sampling), ce qui garantit l'uniformité.
 */
export function secureRandomInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0) {
    throw new RangeError('secureRandomInt : max doit être un entier > 0');
  }
  const rng = globalThis.crypto;
  if (!rng?.getRandomValues) {
    throw new Error('CSPRNG indisponible : impossible de générer un secret.');
  }
  const limite = Math.floor(UINT32_SPACE / max) * max;
  const buf = new Uint32Array(1);
  let tirage: number;
  do {
    rng.getRandomValues(buf);
    tirage = buf[0];
  } while (tirage >= limite);
  return tirage % max;
}

/** Caractère tiré uniformément dans l'alphabet fourni. */
export function secureRandomChar(alphabet: string): string {
  return alphabet[secureRandomInt(alphabet.length)];
}

/**
 * Mélange de Fisher-Yates non biaisé (en place).
 *
 * `Array.prototype.sort(() => 0.5 - Math.random())` produit un comparateur
 * incohérent : le résultat n'est ni uniforme ni déterministe selon le moteur.
 */
export function secureShuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Mot de passe provisoire : au moins une majuscule, une minuscule, un chiffre
 * et un symbole, le reste tiré dans l'alphabet complet, puis mélangé pour ne
 * pas révéler la position des classes de caractères.
 */
export function generateTemporaryPassword(length: number = TEMP_PASSWORD_LENGTH): string {
  const requis = 4;
  if (length < requis) {
    throw new RangeError(`Un mot de passe provisoire fait au moins ${requis} caractères.`);
  }
  const tout = MAJUSCULES + MINUSCULES + CHIFFRES + SYMBOLES;
  const chars = [
    secureRandomChar(MAJUSCULES),
    secureRandomChar(MINUSCULES),
    secureRandomChar(CHIFFRES),
    secureRandomChar(SYMBOLES),
  ];
  while (chars.length < length) chars.push(secureRandomChar(tout));
  return secureShuffle(chars).join('');
}
