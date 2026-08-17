import { describe, it, expect } from 'vitest';
import { parseDateFlexible, relativeTime } from './time';

/** Référence fixe : 15 juin 2025 à 12:00:00 (heure locale). */
const NOW = new Date(2025, 5, 15, 12, 0, 0).getTime();

/** Construit un instant « il y a N secondes » relatif à NOW. */
function agoSec(n: number): string {
  const d = new Date(NOW - n * 1000);
  const p = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

describe('parseDateFlexible', () => {
  it('renvoie null pour une valeur vide, null ou undefined', () => {
    expect(parseDateFlexible('')).toBeNull();
    expect(parseDateFlexible(null)).toBeNull();
    expect(parseDateFlexible(undefined)).toBeNull();
  });

  it('analyse « AAAA-MM-JJ HH:mm » en date locale', () => {
    const d = parseDateFlexible('2025-06-15 14:30')!;
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(5); // juin
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(14);
    expect(d.getMinutes()).toBe(30);
    expect(d.getSeconds()).toBe(0);
  });

  it('analyse « AAAA-MM-JJ HH:mm:ss » en conservant les secondes', () => {
    const d = parseDateFlexible('2025-06-15 14:30:45')!;
    expect(d.getSeconds()).toBe(45);
  });

  it('accepte le séparateur « T » comme l’espace', () => {
    const d = parseDateFlexible('2025-06-15T14:30')!;
    expect(d.getHours()).toBe(14);
    expect(d.getMinutes()).toBe(30);
  });

  it('analyse une date seule « AAAA-MM-JJ » à minuit local', () => {
    const d = parseDateFlexible('2025-06-15')!;
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(5);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(0);
  });

  it('honore le suffixe UTC « Z » (ne l’interprète pas en heure locale)', () => {
    const d = parseDateFlexible('2025-06-15T14:30:00Z')!;
    expect(d.getTime()).toBe(Date.UTC(2025, 5, 15, 14, 30, 0));
  });

  it('honore un fuseau explicite ±HH:MM', () => {
    expect(parseDateFlexible('2025-06-15T14:30:00+02:00')!.getTime())
      .toBe(Date.UTC(2025, 5, 15, 12, 30, 0));
    expect(parseDateFlexible('2025-06-15T14:30:00-05:00')!.getTime())
      .toBe(Date.UTC(2025, 5, 15, 19, 30, 0));
  });

  it('honore le fuseau même avec des fractions de seconde', () => {
    const d = parseDateFlexible('2025-06-15T14:30:00.123Z')!;
    expect(d.getTime()).toBe(Date.UTC(2025, 5, 15, 14, 30, 0) + 123);
  });

  it('interprète en heure locale un horodatage SANS fuseau', () => {
    const d = parseDateFlexible('2025-06-15T14:30:00')!;
    expect(d.getHours()).toBe(14);
    expect(d.getMinutes()).toBe(30);
  });

  it('ignore les espaces de bord', () => {
    expect(parseDateFlexible('  2025-06-15  ')).not.toBeNull();
  });

  it('renvoie null pour une chaîne non analysable', () => {
    expect(parseDateFlexible('pas-une-date')).toBeNull();
  });
});

describe('relativeTime', () => {
  it('renvoie une chaîne vide quand la valeur est absente', () => {
    expect(relativeTime(null, NOW)).toBe('');
    expect(relativeTime(undefined, NOW)).toBe('');
  });

  it('renvoie la valeur brute quand elle est non analysable', () => {
    expect(relativeTime('n/a', NOW)).toBe('n/a');
  });

  it('« à l’instant » en deçà de 60 secondes', () => {
    expect(relativeTime(agoSec(0), NOW)).toBe("à l'instant");
    expect(relativeTime(agoSec(59), NOW)).toBe("à l'instant");
  });

  it('« il y a N min » entre 1 et 59 minutes', () => {
    expect(relativeTime(agoSec(60), NOW)).toBe('il y a 1 min');
    expect(relativeTime(agoSec(5 * 60), NOW)).toBe('il y a 5 min');
    expect(relativeTime(agoSec(59 * 60), NOW)).toBe('il y a 59 min');
  });

  it('« il y a N h » entre 1 et 23 heures', () => {
    expect(relativeTime(agoSec(3600), NOW)).toBe('il y a 1 h');
    expect(relativeTime(agoSec(23 * 3600), NOW)).toBe('il y a 23 h');
  });

  it('« hier » à exactement 1 jour', () => {
    expect(relativeTime(agoSec(24 * 3600), NOW)).toBe('hier');
  });

  it('« il y a N j » entre 2 et 6 jours', () => {
    expect(relativeTime(agoSec(2 * 24 * 3600), NOW)).toBe('il y a 2 j');
    expect(relativeTime(agoSec(6 * 24 * 3600), NOW)).toBe('il y a 6 j');
  });

  it('date courte sans année au-delà de 7 jours dans la même année', () => {
    // 15 juin − 10 j = 5 juin 2025 (même année que NOW)
    expect(relativeTime('2025-06-05', NOW)).toBe('5 juin');
  });

  it('date courte avec année quand l’année diffère', () => {
    expect(relativeTime('2024-05-12', NOW)).toBe('12 mai 2024');
  });

  it('une date future est formatée en date courte (pas de « dans X »)', () => {
    expect(relativeTime('2025-08-20', NOW)).toBe('20 août');
  });

  it('utilise Date.now() par défaut sans faire d’erreur', () => {
    expect(typeof relativeTime('2020-01-01')).toBe('string');
  });
});
