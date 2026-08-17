/**
 * Masques de saisie — compte espèces et téléphone.
 *
 * <p>Les fonctions sont <b>pures</b> : elles prennent la frappe brute et rendent
 * la valeur affichée. Elles sont testées seules, et réutilisées par la directive
 * ci-dessous comme par les écrans.</p>
 */

/** Préfixe imposé du compte espèces (code banque Afriland). */
export const PREFIXE_COMPTE = '10005';
/**
 * Longueur totale du compte espèces, sans les espaces — 23 chiffres (RIB).
 *
 * Le numéro figurant dans la base clients de la banque compte 18 chiffres
 * (agence 5 + compte 11 + clé 2) ; le code banque `10005` le précède.
 */
export const LONGUEUR_COMPTE = 23;
/** Découpage affiché : 10005 00090 56010090000 48 */
const GROUPES_COMPTE = [5, 5, 11, 2];

/** Indicatif imposé du téléphone (Cameroun). */
export const INDICATIF_TEL = '+237';
/** Nombre de chiffres attendus après l'indicatif. */
export const LONGUEUR_TEL = 9;

/** Chiffres seuls d'une saisie. */
export function chiffres(valeur: string): string {
  return (valeur ?? '').replace(/\D/g, '');
}

/**
 * Formate un compte espèces : préfixe `10005` imposé, groupes séparés par des
 * espaces, saisie bornée à 23 chiffres (au-delà, la frappe est ignorée).
 */
export function formaterCompte(saisie: string): string {
  // Le préfixe est imposé : on le réapplique quoi que l'utilisateur tape, ce qui
  // permet aussi de tolérer un collage qui le contient déjà.
  let d = chiffres(saisie);
  if (!d.startsWith(PREFIXE_COMPTE)) {
    d = PREFIXE_COMPTE + d.replace(new RegExp('^' + PREFIXE_COMPTE.slice(0, d.length)), '');
  }
  d = d.slice(0, LONGUEUR_COMPTE);

  const parts: string[] = [];
  let i = 0;
  for (const taille of GROUPES_COMPTE) {
    if (i >= d.length) break;
    parts.push(d.slice(i, i + taille));
    i += taille;
  }
  return parts.join(' ');
}

/** Vrai quand le compte espèces est complet (23 chiffres). */
export function compteComplet(saisie: string): boolean {
  const d = chiffres(saisie);
  return d.length === LONGUEUR_COMPTE && d.startsWith(PREFIXE_COMPTE);
}

/**
 * Retire l'indicatif pays d'une suite de chiffres pour ne garder que le numéro
 * national.
 *
 * <p>Le champ impose toujours le préfixe <code>+237</code> : ses chiffres
 * (« 237 ») sont donc <b>toujours</b> en tête et doivent être retirés une fois,
 * même en cours de frappe (sinon, dès la première touche, « 237 » serait
 * ré-absorbé dans le numéro national — ex. « +237 237 6 »).</p>
 *
 * <p>On retire ensuite d'éventuels indicatifs <b>collés en trop</b> (un +237
 * copié dans la valeur), mais sans jamais amputer un numéro national de 9
 * chiffres qui commencerait par 237.</p>
 */
function sansIndicatif(d: string): string {
  let n = d;
  if (n.startsWith('237')) {
    n = n.slice(3);
  }
  while (n.startsWith('237') && n.length > LONGUEUR_TEL) {
    n = n.slice(3);
  }
  return n;
}

/**
 * Formate un téléphone : indicatif `+237` imposé, puis 9 chiffres maximum.
 * Affiché « +237 6XX XX XX XX ».
 */
export function formaterTelephone(saisie: string): string {
  let d = sansIndicatif(chiffres(saisie));
  d = d.slice(0, LONGUEUR_TEL);
  if (!d) return INDICATIF_TEL + ' ';

  // Groupes 1-2-2-2-2 : « 6XX XX XX XX »
  const parts = [d.slice(0, 3), d.slice(3, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean);
  return `${INDICATIF_TEL} ${parts.join(' ')}`;
}

/** Vrai quand le téléphone est complet (indicatif + 9 chiffres). */
export function telephoneComplet(saisie: string): boolean {
  return sansIndicatif(chiffres(saisie)).length === LONGUEUR_TEL;
}

/** Numéro national seul (9 chiffres), pour l'envoi au backend. */
export function telephoneNational(saisie: string): string {
  return sansIndicatif(chiffres(saisie)).slice(0, LONGUEUR_TEL);
}

/** Téléphone au format international compact, pour l'envoi au backend. */
export function telephoneInternational(saisie: string): string {
  const n = telephoneNational(saisie);
  return n ? INDICATIF_TEL + n : '';
}
