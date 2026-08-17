import { describe, it, expect } from 'vitest';
import {
  PERMISSION_LABELS,
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  PAYS_CEMAC,
  ORDER_STATUS_LABELS,
  EMISSION_STATUS_LABELS,
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_TYPE_PREFIX,
  Permission,
  UserRole,
} from './models';

const ROLES: UserRole[] = ['CLIENT_PP', 'CLIENT_PM', 'AGENT', 'SUPERVISEUR', 'ADMIN'];

describe('PERMISSION_LABELS / ALL_PERMISSIONS', () => {
  it('ALL_PERMISSIONS dérive exactement des clés de PERMISSION_LABELS', () => {
    expect(ALL_PERMISSIONS).toEqual(Object.keys(PERMISSION_LABELS));
  });

  it('chaque permission a un libellé non vide', () => {
    for (const p of ALL_PERMISSIONS) {
      expect(PERMISSION_LABELS[p]?.trim().length).toBeGreaterThan(0);
    }
  });

  it('les libellés sont uniques', () => {
    const labels = Object.values(PERMISSION_LABELS);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('DEFAULT_ROLE_PERMISSIONS', () => {
  it('couvre les cinq rôles', () => {
    expect(Object.keys(DEFAULT_ROLE_PERMISSIONS).sort()).toEqual([...ROLES].sort());
  });

  it('n’accorde aucune permission back-office aux clients', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.CLIENT_PP).toEqual([]);
    expect(DEFAULT_ROLE_PERMISSIONS.CLIENT_PM).toEqual([]);
  });

  it.each(ROLES)('les permissions de %s sont toutes déclarées et sans doublon', (role) => {
    const perms = DEFAULT_ROLE_PERMISSIONS[role];
    expect(new Set(perms).size).toBe(perms.length);
    for (const p of perms) expect(ALL_PERMISSIONS).toContain(p);
  });

  // ── Séparation des tâches (CSFT §1.3 — moindre privilège) ─────────────────

  it('seul ADMIN gère les utilisateurs internes', () => {
    const avec = ROLES.filter((r) => DEFAULT_ROLE_PERMISSIONS[r].includes('USER_MANAGE'));
    expect(avec).toEqual(['ADMIN']);
  });

  it('seul ADMIN consulte le journal d’audit', () => {
    const avec = ROLES.filter((r) => DEFAULT_ROLE_PERMISSIONS[r].includes('AUDIT_READ'));
    expect(avec).toEqual(['ADMIN']);
  });

  it('l’AGENT saisit l’adjudication mais ne la valide pas', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.AGENT).toContain('ORDER_RESULT');
    expect(DEFAULT_ROLE_PERMISSIONS.AGENT).not.toContain('ORDER_RESULT_VALIDATE');
  });

  it('le SUPERVISEUR valide l’adjudication mais ne la saisit pas', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.SUPERVISEUR).toContain('ORDER_RESULT_VALIDATE');
    expect(DEFAULT_ROLE_PERMISSIONS.SUPERVISEUR).not.toContain('ORDER_RESULT');
  });

  it('l’ADMIN ne participe à aucune adjudication', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.ADMIN).not.toContain('ORDER_RESULT');
    expect(DEFAULT_ROLE_PERMISSIONS.ADMIN).not.toContain('ORDER_RESULT_VALIDATE');
    expect(DEFAULT_ROLE_PERMISSIONS.ADMIN).not.toContain('ORDER_VALIDATE');
  });

  it('seul l’ADMIN peut supprimer une fiche émission', () => {
    const avec = ROLES.filter((r) => DEFAULT_ROLE_PERMISSIONS[r].includes('EMISSION_DELETE'));
    expect(avec).toEqual(['ADMIN']);
  });

  it('toute permission déclarée est accordée à au moins un rôle', () => {
    const accordees = new Set<Permission>(ROLES.flatMap((r) => DEFAULT_ROLE_PERMISSIONS[r]));
    for (const p of ALL_PERMISSIONS) expect(accordees.has(p)).toBe(true);
  });
});

describe('PAYS_CEMAC', () => {
  it('recense les 6 États membres', () => {
    expect(Object.keys(PAYS_CEMAC)).toHaveLength(6);
  });

  it('utilise des codes ISO à 3 lettres majuscules', () => {
    for (const code of Object.keys(PAYS_CEMAC)) {
      expect(code).toMatch(/^[A-Z]{3}$/);
    }
  });

  it('associe chaque code à un nom non vide et unique', () => {
    const noms = Object.values(PAYS_CEMAC);
    expect(new Set(noms).size).toBe(noms.length);
    for (const n of noms) expect(n.trim().length).toBeGreaterThan(0);
  });

  it('mappe les codes attendus', () => {
    expect(PAYS_CEMAC.CMR).toBe('Cameroun');
    expect(PAYS_CEMAC.GNQ).toBe('Guinée Équatoriale');
  });
});

describe.each([
  ['ORDER_STATUS_LABELS', ORDER_STATUS_LABELS],
  ['EMISSION_STATUS_LABELS', EMISSION_STATUS_LABELS],
  ['DOCUMENT_TYPE_LABELS', DOCUMENT_TYPE_LABELS],
])('%s', (_name, map) => {
  it('associe chaque clé à un libellé non vide', () => {
    const entries = Object.entries(map);
    expect(entries.length).toBeGreaterThan(0);
    for (const [, label] of entries) {
      expect(String(label).trim().length).toBeGreaterThan(0);
    }
  });
});

describe('DOCUMENT_TYPE_PREFIX', () => {
  it('couvre exactement les mêmes types que DOCUMENT_TYPE_LABELS', () => {
    expect(Object.keys(DOCUMENT_TYPE_PREFIX).sort())
      .toEqual(Object.keys(DOCUMENT_TYPE_LABELS).sort());
  });

  it('les préfixes sont uniques, courts et en majuscules', () => {
    const prefixes = Object.values(DOCUMENT_TYPE_PREFIX);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    for (const p of prefixes) expect(p).toMatch(/^[A-Z]{2,6}$/);
  });
});
