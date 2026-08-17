/**
 * Formatage de date relatif (« il y a 5 min », « hier », « 12 mai »).
 * Accepte une date ISO ou « AAAA-MM-JJ HH:mm ». Robuste : renvoie la chaîne
 * d'origine si elle n'est pas analysable.
 */
const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** « AAAA-MM-JJ[ T]HH:mm[:ss] » — quantificateurs bornés, coût linéaire. */
const PREFIXE_DATE_HEURE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/;
/** Suffixe « [.fraction]Z » ou « [.fraction]±HH:MM » — indique un fuseau explicite. */
const SUFFIXE_FUSEAU = /^(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i;

export function parseDateFlexible(value: string | undefined | null): Date | null {
  if (!value) return null;
  let s = String(value).trim();
  // « AAAA-MM-JJ HH:mm[:ss] » sans fuseau → interprété en heure LOCALE.
  // Si un fuseau explicite est présent (Z ou ±HH:MM), on délègue au
  // constructeur Date pour ne pas ignorer le décalage (sinon 14:30Z serait
  // lu comme 14:30 locales → « il y a 1 h » erroné).
  // Les deux motifs sont à quantificateurs disjoints (aucun retour arrière
  // super-linéaire possible) et le suffixe est isolé par slice, pas capturé.
  const m = PREFIXE_DATE_HEURE.exec(s);
  if (m && !SUFFIXE_FUSEAU.test(s.slice(m[0].length).trim())) {
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0);
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** « à l'instant », « il y a 5 min », « il y a 3 h », « hier », « 12 mai », « 12 mai 2025 ». */
export function relativeTime(value: string | undefined | null, now: number = Date.now()): string {
  const d = parseDateFlexible(value);
  if (!d) return value ? String(value) : '';
  const diffSec = Math.round((now - d.getTime()) / 1000);
  if (diffSec < 0) return formatShort(d, now);
  if (diffSec < 60) return "à l'instant";
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.floor(h / 24);
  if (j === 1) return 'hier';
  if (j < 7) return `il y a ${j} j`;
  return formatShort(d, now);
}

function formatShort(d: Date, now: number): string {
  const sameYear = new Date(now).getFullYear() === d.getFullYear();
  const base = `${d.getDate()} ${MOIS_COURTS[d.getMonth()]}`;
  return sameYear ? base : `${base} ${d.getFullYear()}`;
}
