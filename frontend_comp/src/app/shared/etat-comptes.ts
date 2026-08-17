/**
 * Complétude des coordonnées bancaires d'un client.
 *
 * À l'inscription en ligne, le client ne renseigne que son **compte espèces** ;
 * le **compte-titres** lui est attribué ensuite par un agent du back-office. Il
 * peut soumettre des ordres entre-temps — mais le back-office doit voir d'un
 * coup d'œil quels comptes restent à compléter : **rouge** tant qu'il manque un
 * numéro, **vert** quand les deux sont renseignés.
 */
export type EtatComptes = 'COMPLET' | 'INCOMPLET';

/** Un numéro absent, vide ou fait d'espaces ne compte pas comme renseigné. */
export function estRenseigne(numero: string | null | undefined): boolean {
  return typeof numero === 'string' && numero.trim().length > 0;
}

export function etatComptes(
  compteTitres: string | null | undefined,
  compteEspeces: string | null | undefined,
): EtatComptes {
  return estRenseigne(compteTitres) && estRenseigne(compteEspeces) ? 'COMPLET' : 'INCOMPLET';
}

/** Classes Tailwind — vert si les deux comptes sont là, rouge sinon. */
export function classeEtatComptes(
  compteTitres: string | null | undefined,
  compteEspeces: string | null | undefined,
): string {
  return etatComptes(compteTitres, compteEspeces) === 'COMPLET'
    ? 'text-green-700 bg-green-50'
    : 'text-red-700 bg-red-50';
}

/** Libellé à afficher à la place d'un numéro manquant. */
export const COMPTE_NON_RENSEIGNE = 'Non renseigné';

export function afficherCompte(numero: string | null | undefined): string {
  return estRenseigne(numero) ? (numero as string).trim() : COMPTE_NON_RENSEIGNE;
}
