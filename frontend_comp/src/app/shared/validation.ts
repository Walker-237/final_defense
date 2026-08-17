/**
 * Validations de saisie partagées entre les écrans d'authentification.
 */

/** Longueur maximale d'une adresse e-mail (RFC 5321 §4.5.3.1.3). */
export const EMAIL_MAX_LENGTH = 254;

/**
 * Adresse e-mail « raisonnable » : un local-part, un arobase, un domaine
 * comportant au moins un point.
 *
 * Les classes sont **disjointes** des séparateurs qui les suivent
 * (`[^\s@]+` précède `@` ; `[^\s@.]+` précède `.`) : aucune ambiguïté, donc
 * aucun retour arrière super-linéaire (ReDoS). La forme naïve
 * `^[^\s@]+@[^\s@]+\.[^\s@]+$` est quadratique car `.` appartient à `[^\s@]`.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/**
 * Vrai si `value` est une adresse e-mail syntaxiquement plausible.
 * La longueur est bornée avant l'évaluation du motif (défense en profondeur).
 */
export function isValidEmail(value: string | null | undefined): boolean {
  if (!value) return false;
  const email = value.trim();
  if (email.length === 0 || email.length > EMAIL_MAX_LENGTH) return false;
  return EMAIL_RE.test(email);
}
