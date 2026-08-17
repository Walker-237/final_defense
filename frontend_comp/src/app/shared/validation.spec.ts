import { describe, it, expect } from 'vitest';
import { isValidEmail, EMAIL_MAX_LENGTH } from './validation';

describe('isValidEmail', () => {
  it('rejette une valeur absente ou vide', () => {
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('   ')).toBe(false);
  });

  it.each([
    'a@b.cm',
    'jean.dupont@afrilandfirstbank.cm',
    'jean+tag@sous.domaine.example.org',
    'JEAN@EXEMPLE.CM',
    "o'brien@exemple.cm",
  ])('accepte « %s »', (email) => {
    expect(isValidEmail(email)).toBe(true);
  });

  it.each([
    'sans-arobase.cm',
    '@exemple.cm',
    'a@',
    'a@b',            // domaine sans point
    'a@.cm',          // libellé de domaine vide
    'a@b.',           // TLD vide
    'a b@exemple.cm', // espace
    'a@exemple .cm',
    'a@@b.cm',
    'a@b..cm',        // libellé vide entre deux points
  ])('rejette « %s »', (email) => {
    expect(isValidEmail(email)).toBe(false);
  });

  it('tolère les espaces de bord', () => {
    expect(isValidEmail('  a@b.cm  ')).toBe(true);
  });

  it('accepte un e-mail à la longueur maximale RFC 5321', () => {
    const suffixe = '@exemple.cm'; // 11 caractères
    const local = 'a'.repeat(EMAIL_MAX_LENGTH - suffixe.length);
    expect(isValidEmail(local + suffixe)).toBe(true);
  });

  it('rejette un e-mail dépassant la longueur maximale', () => {
    const suffixe = '@exemple.cm';
    const local = 'a'.repeat(EMAIL_MAX_LENGTH - suffixe.length + 1);
    expect(isValidEmail(local + suffixe)).toBe(false);
  });

  it('reste linéaire face à une entrée pathologique (anti-ReDoS)', () => {
    // Motif classique de blow-up quadratique : long local-part sans point au domaine.
    const hostile = 'a'.repeat(50_000) + '@' + 'b'.repeat(50_000);
    const t0 = performance.now();
    expect(isValidEmail(hostile)).toBe(false); // rejeté d'abord par la borne de longueur
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
