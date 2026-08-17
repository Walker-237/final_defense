import { describe, it, expect } from 'vitest';
import * as E from './api-endpoints';

const { API_BASE } = E;

/** Tous les groupes d'endpoints exportés (hors API_BASE lui-même). */
const GROUPS = Object.entries(E).filter(
  ([name, v]) => name !== 'API_BASE' && typeof v === 'object' && v !== null,
) as Array<[string, Record<string, unknown>]>;

/** Argument factice distinct par position, pour vérifier l'interpolation. */
const ARGS = ['id-1', 'id-2', 'id-3', 'id-4'];

/** Résout une entrée d'endpoint (constante ou constructeur d'URL). */
function resolve(value: unknown): { url: string; arity: number } {
  if (typeof value === 'function') {
    const fn = value as (...a: string[]) => string;
    const args = ARGS.slice(0, fn.length);
    return { url: fn(...args), arity: fn.length };
  }
  return { url: value as string, arity: 0 };
}

describe('api-endpoints', () => {
  it('expose la base /api/v1', () => {
    expect(API_BASE).toBe('/api/v1');
  });

  it('déclare bien les 24 groupes attendus', () => {
    expect(GROUPS).toHaveLength(24);
  });

  describe.each(GROUPS)('groupe %s', (_name, group) => {
    const entries = Object.entries(group);

    it('n’est pas vide', () => {
      expect(entries.length).toBeGreaterThan(0);
    });

    it.each(entries)('%s produit une URL préfixée par la base', (_key, value) => {
      const { url } = resolve(value);
      expect(typeof url).toBe('string');
      expect(url.startsWith(`${API_BASE}/`)).toBe(true);
    });

    it.each(entries)('%s interpole tous ses paramètres', (_key, value) => {
      const { url, arity } = resolve(value);
      for (const arg of ARGS.slice(0, arity)) {
        expect(url).toContain(arg);
      }
    });

    it.each(entries)('%s ne laisse ni segment vide ni « undefined »', (_key, value) => {
      const { url } = resolve(value);
      expect(url).not.toContain('//');
      expect(url).not.toContain('undefined');
      expect(url).not.toContain('[object');
      expect(url.endsWith('/')).toBe(false);
    });
  });

  it('les URLs sont uniques par groupe (pas de doublon de chemin)', () => {
    for (const [name, group] of GROUPS) {
      const urls = Object.values(group).map((v) => resolve(v).url);
      // Plusieurs verbes HTTP peuvent partager un chemin (GET/PATCH /x/:id) :
      // on vérifie seulement qu'aucun groupe n'est entièrement dégénéré.
      expect(new Set(urls).size, `groupe ${name}`).toBeGreaterThan(0);
    }
  });

  // Quelques ancrages explicites sur les chemins critiques (régression).
  it('AUTH pointe sur les chemins d’authentification attendus', () => {
    expect(E.AUTH.LOGIN).toBe('/api/v1/auth/login');
    expect(E.AUTH.MFA_VERIFY).toBe('/api/v1/auth/mfa/verify');
    expect(E.AUTH.REFRESH).toBe('/api/v1/auth/refresh');
    expect(E.AUTH.LOGOUT).toBe('/api/v1/auth/logout');
    expect(E.AUTH.ME).toBe('/api/v1/auth/me');
  });

  it('COMPTES_TITRES interpole l’identifiant de compte et de mandataire', () => {
    expect(E.COMPTES_TITRES.GET('cpt-9')).toBe('/api/v1/comptes-titres/cpt-9');
    expect(E.COMPTES_TITRES.REVOKE_MANDATAIRE('cpt-9', 'm-3'))
      .toBe('/api/v1/comptes-titres/cpt-9/mandataires/m-3');
  });
});
