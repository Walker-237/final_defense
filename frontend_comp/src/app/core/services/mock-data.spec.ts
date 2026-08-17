import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { MockData, dureeAffichage } from './mock-data';
import { ApiService } from './api';
import {
  CompteTitres, Emission, Order, Position, ClientDossier, Contact, UserRole,
  DEFAULT_ROLE_PERMISSIONS,
} from '../models/models';

// ─── Fabriques de données réalistes ─────────────────────────────────────────

function makeCompte(over: Partial<CompteTitres> = {}): CompteTitres {
  return {
    id: 'ct1', numero: 'CT-001', typeCompte: 'INDIVIDUEL', statut: 'ACTIF',
    dateOuverture: '2026-01-01', categorie: 'NON_QUALIFIE', compteEspecesLie: 'CE-001',
    soldeEspeces: 0, adresses: [], contacts: [], sousComptes: [], ...over,
  };
}

function makeEmission(over: Partial<Emission> = {}): Emission {
  return {
    id: 'em1', code: 'BTA-CMR-26-01', isin: 'CM0000000001', libelle: 'BTA Cameroun 26',
    nature: 'BTA', paysCode: 'CMR', emetteur: 'Cameroun', dateEmission: '2026-01-01',
    fermetureSouscription: '2026-02-01', dateEcheance: '2026-07-01', dureeJours: 182,
    valeurNominaleUnitaire: 10000, montantGlobal: 1_000_000, tauxNominal: 5,
    montantMinimum: 10000, modeAdjudication: 'TAUX', status: 'PUBLIE',
    ouvertureSouscription: '2026-01-01', dateReglement: '2026-01-02', ...over,
  };
}

function makeOrder(over: Partial<Order> = {}): Order {
  return {
    id: 'o1', reference: 'ORD-2026-000001', emissionId: 'em1', emissionCode: 'BTA-CMR-26-01',
    isin: 'CM0000000001', nature: 'BTA', emetteur: 'Cameroun', clientId: 'u1', clientNom: 'Doe',
    compteEspeces: '123', compteTitres: '456', volume: 10, montant: 100000, tauxSoumis: 5,
    status: 'SOUMIS', dateSoumission: '2026-01-05 10:00', canal: 'EN_LIGNE', ...over,
  };
}

function makePosition(over: Partial<Position> = {}): Position {
  return {
    emissionCode: 'BTA-CMR-26-01', isin: 'CM0000000001', nature: 'BTA', emetteur: 'Cameroun',
    dateEmission: '2026-01-01', dateEcheance: '2030-01-01', volume: 10, valeurNominale: 10000,
    valeurTotale: 100000, tauxNominal: 5, ...over,
  };
}

function makeDossier(over: Partial<ClientDossier> = {}): ClientDossier {
  return {
    id: 'c1', type: 'PP', raisonSociale: 'Doe SARL', createdAt: '2026-01-01',
    compte: makeCompte(), ...over,
  };
}

function makeContact(over: Partial<Contact> = {}): Contact {
  return { id: 's1', type: 'TITULAIRE', nom: 'Doe', ...over };
}

function makeSousCompte(numero: string) {
  return {
    numero, libelle: 'Conservation', type: 'CONSERVATION' as const, statut: 'ACTIF' as const,
    dateOuverture: '2026-01-01', positionsCount: 0, valeurTotale: 0,
  };
}

/** Double d'ApiService : chaque méthode utilisée renvoie un Observable synchrone. */
function makeApi(over: Record<string, any> = {}): Record<string, any> {
  const base: Record<string, any> = {
    listEmissions: vi.fn(() => of([])),
    getMarcheConfig: vi.fn(() => of(null)),
    updateMarcheConfig: vi.fn((c: any) => of(c)),
    listOrders: vi.fn(() => of([])),
    listAudit: vi.fn(() => of([])),
    listPortfolio: vi.fn(() => of({ clientId: 'u1', positions: [], lignesActives: 0, valeurTotale: 0, soldeEspeces: 0 })),
    listDocuments: vi.fn(() => of([])),
    generateAttestation: vi.fn(() => of(null)),
    listRolePermissions: vi.fn(() => of(null)),
    listNotifications: vi.fn(() => of([])),
    listClientDossiers: vi.fn(() => of([])),
    getMyDossier: vi.fn(() => of(null)),
    markNotificationRead: vi.fn(() => of(void 0)),
    markAllNotificationsRead: vi.fn(() => of(void 0)),
    setRolePermission: vi.fn(() => of(null)),
    createOrder: vi.fn(() => of(makeOrder())),
    updateOrder: vi.fn(() => of(makeOrder())),
    cancelOrder: vi.fn(() => of(makeOrder({ status: 'ANNULE' }))),
    validateOrder: vi.fn(() => of(makeOrder({ status: 'EN_ATTENTE_ADJUDICATION' }))),
    rejectOrder: vi.fn(() => of(makeOrder({ status: 'ANNULE' }))),
    changeOrderStatus: vi.fn(() => of(makeOrder())),
    validateOrderResult: vi.fn(() => of(makeOrder())),
    rejectOrderResult: vi.fn(() => of(makeOrder())),
    setOrderNotes: vi.fn(() => of(makeOrder())),
    verifyOrderSignature: vi.fn(() => of(makeOrder())),
    createEmission: vi.fn(() => of(makeEmission({ status: 'BROUILLON' }))),
    publishEmission: vi.fn(() => of(makeEmission({ status: 'PUBLIE' }))),
    updateEmission: vi.fn(() => of(makeEmission())),
    rejectEmission: vi.fn(() => of(makeEmission())),
    closeEmission: vi.fn(() => of(makeEmission({ status: 'CLOTURE' }))),
    archiveEmission: vi.fn(() => of(makeEmission({ status: 'ARCHIVE' }))),
    publishAllEmissions: vi.fn(() => of({ published: 0, codes: [] })),
    createClient: vi.fn(() => of(makeDossier())),
  };
  return { ...base, ...over };
}

describe('MockData', () => {
  let svc: MockData;
  let api: Record<string, any>;

  function setup(apiOver: Record<string, any> = {}, platform: 'browser' | 'server' = 'browser') {
    TestBed.resetTestingModule();
    api = makeApi(apiOver);
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: PLATFORM_ID, useValue: platform },
      ],
    });
    svc = TestBed.inject(MockData);
    // Les endpoints « list » renvoient l'état courant des signaux : cela modélise
    // un backend qui restitue l'état venant d'être persisté, de sorte qu'un
    // refresh consécutif à une mutation optimiste préserve celle-ci (au lieu de
    // l'écraser par une liste vide de démonstration).
    api['listEmissions'] = vi.fn(() => of(svc.emissions()));
    api['listOrders'] = vi.fn(() => of(svc.orders()));
    api['listNotifications'] = vi.fn(() => of(svc.notifications()));
    api['listAudit'] = vi.fn(() => of(svc.audit()));
    // Le constructeur hydrate via queueMicrotask ; on repart d'un historique propre.
    for (const fn of Object.values(api)) (fn as any).mockClear?.();
  }

  beforeEach(() => {
    sessionStorage.clear();
    setup();
  });
  afterEach(() => vi.restoreAllMocks());

  // ═══════════════════ Helpers purs ════════════════════════════════════════

  describe('dureeAffichage', () => {
    it('exprime un BTA en semaines', () => {
      expect(dureeAffichage({ nature: 'BTA', dureeJours: 7 })).toBe('1 semaine');
      expect(dureeAffichage({ nature: 'BTA', dureeJours: 14 })).toBe('2 semaines');
      expect(dureeAffichage({ nature: 'BTA', dureeJours: 182 })).toBe('26 semaines');
    });

    it('exprime un OTA en années, entières sans décimale', () => {
      expect(dureeAffichage({ nature: 'OTA', dureeJours: 365 })).toBe('1 an');
      expect(dureeAffichage({ nature: 'OTA', dureeJours: 730 })).toBe('2 ans');
    });

    it('exprime un OTA fractionnaire avec une virgule décimale', () => {
      expect(dureeAffichage({ nature: 'OTA', dureeJours: 548 })).toBe('1,5 ans');
    });
  });

  // ═══════════════════ État initial ════════════════════════════════════════

  it('démarre non authentifié avec un utilisateur vide et des collections vides', () => {
    expect(svc.isAuthenticated()).toBe(false);
    expect(svc.currentUser().id).toBe('');
    expect(svc.emissions()).toEqual([]);
    expect(svc.orders()).toEqual([]);
    expect(svc.positions()).toEqual([]);
    expect(svc.documents()).toEqual([]);
    expect(svc.notifications()).toEqual([]);
    expect(svc.audit()).toEqual([]);
    expect(svc.clientsRegistry()).toEqual([]);
  });

  it('initialise la matrice RBAC sur les valeurs par défaut du CSFT', () => {
    expect(svc.rolePermissions()).toEqual(DEFAULT_ROLE_PERMISSIONS);
  });

  // ═══════════════════ hasPermission ═══════════════════════════════════════

  describe('hasPermission', () => {
    it('n’accorde aucune permission back-office aux clients', () => {
      svc.currentUser.update((u) => ({ ...u, role: 'CLIENT_PP' as UserRole }));
      expect(svc.hasPermission('EMISSION_CREATE')).toBe(false);
      expect(svc.hasPermission('ORDER_VALIDATE')).toBe(false);
    });

    it('reflète la matrice par défaut pour AGENT', () => {
      svc.currentUser.update((u) => ({ ...u, role: 'AGENT' as UserRole }));
      expect(svc.hasPermission('ORDER_RESULT')).toBe(true);
      expect(svc.hasPermission('CLIENT_CREATE')).toBe(true);
      expect(svc.hasPermission('ORDER_RESULT_VALIDATE')).toBe(false);
      expect(svc.hasPermission('USER_MANAGE')).toBe(false);
    });

    it('reflète la matrice par défaut pour SUPERVISEUR', () => {
      svc.currentUser.update((u) => ({ ...u, role: 'SUPERVISEUR' as UserRole }));
      expect(svc.hasPermission('EMISSION_VALIDATE')).toBe(true);
      expect(svc.hasPermission('ORDER_RESULT_VALIDATE')).toBe(true);
      expect(svc.hasPermission('ORDER_RESULT')).toBe(false);
    });

    it('reflète la matrice par défaut pour ADMIN', () => {
      svc.currentUser.update((u) => ({ ...u, role: 'ADMIN' as UserRole }));
      expect(svc.hasPermission('AUDIT_READ')).toBe(true);
      expect(svc.hasPermission('USER_MANAGE')).toBe(true);
      expect(svc.hasPermission('ORDER_RESULT')).toBe(false);
    });

    it('renvoie false pour un rôle absent de la matrice', () => {
      svc.currentUser.update((u) => ({ ...u, role: 'INCONNU' as UserRole }));
      expect(svc.hasPermission('AUDIT_READ')).toBe(false);
    });
  });

  describe('matrice RBAC — override', () => {
    it('toggleRolePermission applique la matrice renvoyée par le backend', () => {
      const matrix = { ...DEFAULT_ROLE_PERMISSIONS, CLIENT_PP: ['REPORTING_READ'] };
      api['setRolePermission'] = vi.fn(() => of(matrix));
      svc.currentUser.update((u) => ({ ...u, role: 'CLIENT_PP' as UserRole }));

      svc.toggleRolePermission('CLIENT_PP', 'REPORTING_READ');

      expect(api['setRolePermission']).toHaveBeenCalledWith('CLIENT_PP', 'REPORTING_READ', true);
      expect(svc.hasPermission('REPORTING_READ')).toBe(true);
    });

    it('toggleRolePermission retire une permission déjà présente (granted=false)', () => {
      api['setRolePermission'] = vi.fn(() => of(null));
      svc.toggleRolePermission('AGENT', 'ORDER_RESULT');
      expect(api['setRolePermission']).toHaveBeenCalledWith('AGENT', 'ORDER_RESULT', false);
    });

    it('toggleRolePermission n’altère rien si le backend échoue', () => {
      api['setRolePermission'] = vi.fn(() => throwError(() => new Error('x')));
      svc.toggleRolePermission('CLIENT_PP', 'REPORTING_READ');
      expect(svc.rolePermissions()).toEqual(DEFAULT_ROLE_PERMISSIONS);
    });

    it('resetRolePermissions restaure les valeurs par défaut et journalise', () => {
      svc.rolePermissions.set({ ...DEFAULT_ROLE_PERMISSIONS, CLIENT_PP: ['AUDIT_READ'] } as any);
      svc.resetRolePermissions();
      expect(svc.rolePermissions()).toEqual(DEFAULT_ROLE_PERMISSIONS);
      expect(svc.audit().some((a) => a.action === 'REINIT_MATRICE_PERMISSIONS')).toBe(true);
    });

    it('refreshPermissions applique la matrice reçue', () => {
      const matrix = { ...DEFAULT_ROLE_PERMISSIONS, CLIENT_PM: ['REPORTING_READ'] };
      api['listRolePermissions'] = vi.fn(() => of(matrix));
      svc.refreshPermissions();
      expect(svc.rolePermissions().CLIENT_PM).toEqual(['REPORTING_READ']);
    });
  });

  // ═══════════════════ refreshXxx ══════════════════════════════════════════

  describe('refreshXxx — succès', () => {
    it('refreshEmissions peuple le signal emissions', () => {
      const list = [makeEmission({ id: 'em9' })];
      api['listEmissions'] = vi.fn(() => of(list));
      svc.refreshEmissions();
      expect(svc.emissions()).toEqual(list);
    });

    it('refreshOrders peuple le signal orders', () => {
      const list = [makeOrder({ id: 'o9' })];
      api['listOrders'] = vi.fn(() => of(list));
      svc.refreshOrders();
      expect(svc.orders()).toEqual(list);
    });

    it('refreshAudit peuple le signal audit', () => {
      const list = [{ id: 'a1', horodatage: '', utilisateur: 'u', action: 'X', resultat: 'SUCCES' as const, reference: 'R', ip: '' }];
      api['listAudit'] = vi.fn(() => of(list));
      svc.refreshAudit();
      expect(svc.audit()).toEqual(list);
    });

    it('refreshPositions peuple positions et détecte les échéances atteintes', () => {
      const positions = [makePosition({ dateEcheance: '2000-01-01', isin: 'CM0000000009' })];
      api['listPortfolio'] = vi.fn(() => of({ clientId: 'u1', positions, lignesActives: 1, valeurTotale: 1, soldeEspeces: 0 }));
      svc.refreshPositions();
      expect(svc.positions()).toEqual(positions);
      expect(svc.notifications().some((n) => n.titre.startsWith('Échéance atteinte'))).toBe(true);
    });

    it('refreshPositions ne notifie pas une position non échue', () => {
      const positions = [makePosition({ dateEcheance: '2999-01-01' })];
      api['listPortfolio'] = vi.fn(() => of({ clientId: 'u1', positions, lignesActives: 1, valeurTotale: 1, soldeEspeces: 0 }));
      svc.refreshPositions();
      expect(svc.notifications()).toEqual([]);
    });

    it('refreshDocuments peuple le signal documents', () => {
      const list = [{ id: 'd1', reference: 'R', type: 'AVIS_OPERATION', titre: 'T', clientId: 'u1', clientNom: '', uploadedBy: 'u1', mimeType: 'x', telechargements: 0, dateGeneration: '2026-01-01' }];
      api['listDocuments'] = vi.fn(() => of(list));
      svc.refreshDocuments();
      expect(svc.documents()).toEqual(list);
    });

    it('refreshNotifications peuple le signal notifications', () => {
      const list = [{ id: 'n1', type: 'INFO' as const, titre: 'T', message: 'M', date: '2026-01-01', lu: false, canal: ['IN_APP' as const] }];
      api['listNotifications'] = vi.fn(() => of(list));
      svc.refreshNotifications();
      expect(svc.notifications()).toEqual(list);
    });

    it('refreshClients peuple le registre', () => {
      const list = [makeDossier({ id: 'c9' })];
      api['listClientDossiers'] = vi.fn(() => of(list));
      svc.refreshClients();
      expect(svc.clientsRegistry()).toEqual(list);
    });

    it('refreshMarcheConfig applique la configuration reçue', () => {
      api['getMarcheConfig'] = vi.fn(() => of({ statuses: ['PUBLIE', 'CLOTURE'], dateDu: '2026-01-01', dateAu: '2026-12-31' }));
      svc.refreshMarcheConfig();
      expect(svc.marcheConfig()).toEqual({ statuses: ['PUBLIE', 'CLOTURE'], dateDu: '2026-01-01', dateAu: '2026-12-31' });
    });

    it('refreshMyCompte rattache le compte au currentUser', () => {
      const compte = makeCompte({ id: 'ct9', numero: 'CT-009' });
      api['getMyDossier'] = vi.fn(() => of(makeDossier({ compte })));
      svc.refreshMyCompte();
      expect(svc.currentUser().compte).toEqual(compte);
    });
  });

  describe('refreshXxx — dégradation sur erreur API', () => {
    it('refreshEmissions conserve l’état sur erreur', () => {
      api['listEmissions'] = vi.fn(() => throwError(() => new Error('boom')));
      expect(() => svc.refreshEmissions()).not.toThrow();
      expect(svc.emissions()).toEqual([]);
    });

    it('refreshOrders conserve l’état sur erreur', () => {
      api['listOrders'] = vi.fn(() => throwError(() => new Error('boom')));
      svc.refreshOrders();
      expect(svc.orders()).toEqual([]);
    });

    it('refreshPositions conserve l’état sur erreur', () => {
      api['listPortfolio'] = vi.fn(() => throwError(() => new Error('boom')));
      svc.refreshPositions();
      expect(svc.positions()).toEqual([]);
    });

    it('refreshClients conserve l’état sur erreur', () => {
      api['listClientDossiers'] = vi.fn(() => throwError(() => new Error('boom')));
      svc.refreshClients();
      expect(svc.clientsRegistry()).toEqual([]);
    });

    it('refreshMarcheConfig conserve la config par défaut sur erreur', () => {
      api['getMarcheConfig'] = vi.fn(() => throwError(() => new Error('boom')));
      svc.refreshMarcheConfig();
      expect(svc.marcheConfig().statuses).toEqual(['PUBLIE']);
    });
  });

  describe('garde SSR (plateforme serveur)', () => {
    it('les refresh n’appellent pas le backend hors navigateur', () => {
      setup({}, 'server');
      svc.refreshEmissions();
      svc.refreshOrders();
      svc.refreshPositions();
      svc.refreshDocuments();
      svc.refreshClients();
      expect(api['listEmissions']).not.toHaveBeenCalled();
      expect(api['listOrders']).not.toHaveBeenCalled();
      expect(api['listPortfolio']).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════ Notifications — marquage lu ═════════════════════════

  it('markNotificationRead notifie le backend puis resynchronise', () => {
    svc.markNotificationRead('n1');
    expect(api['markNotificationRead']).toHaveBeenCalledWith('n1');
    expect(api['listNotifications']).toHaveBeenCalled();
  });

  it('markAllNotificationsRead notifie le backend puis resynchronise', () => {
    svc.markAllNotificationsRead();
    expect(api['markAllNotificationsRead']).toHaveBeenCalled();
    expect(api['listNotifications']).toHaveBeenCalled();
  });

  // ═══════════════════ getEmission / getOrder ══════════════════════════════

  describe('getEmission / getOrder', () => {
    it('retrouvent une entité par id', () => {
      svc.emissions.set([makeEmission({ id: 'emX' })]);
      svc.orders.set([makeOrder({ id: 'oX' })]);
      expect(svc.getEmission('emX')?.id).toBe('emX');
      expect(svc.getOrder('oX')?.id).toBe('oX');
    });

    it('renvoient undefined pour un id inconnu', () => {
      expect(svc.getEmission('nope')).toBeUndefined();
      expect(svc.getOrder('nope')).toBeUndefined();
    });
  });

  // ═══════════════════ addOrder ════════════════════════════════════════════

  describe('addOrder', () => {
    it('renvoie null si l’émission n’existe pas', () => {
      const got = vi.fn();
      svc.addOrder({ emissionId: 'absent', volume: 1, taux: 5, compteEspeces: 'x' }).subscribe(got);
      expect(got).toHaveBeenCalledWith(null);
      expect(api['createOrder']).not.toHaveBeenCalled();
    });

    it('crée l’ordre, l’ajoute en tête et resynchronise les notifications', () => {
      svc.emissions.set([makeEmission()]);
      const created = makeOrder({ id: 'oNew' });
      api['createOrder'] = vi.fn(() => of(created));
      const got = vi.fn();
      svc.addOrder({ emissionId: 'em1', volume: 5, taux: 4, compteEspeces: 'CE', signatureData: 'sig' }).subscribe(got);

      expect(api['createOrder']).toHaveBeenCalledWith({ emissionId: 'em1', volume: 5, tauxSoumis: 4, signatureData: 'sig' });
      expect(got).toHaveBeenCalledWith(created);
      expect(svc.orders()[0].id).toBe('oNew');
      expect(api['listNotifications']).toHaveBeenCalled();
    });

    it('remonte le motif métier et pousse une notification d’erreur en cas d’échec', () => {
      svc.emissions.set([makeEmission()]);
      api['createOrder'] = vi.fn(() => throwError(() => ({ error: { error: { message: 'Ordre déjà soumis.' } } })));
      const err = vi.fn();
      svc.addOrder({ emissionId: 'em1', volume: 5, taux: 4, compteEspeces: 'CE' }).subscribe({ error: err });

      expect(err).toHaveBeenCalledWith(new Error('Ordre déjà soumis.'));
      expect(svc.notifications().some((n) => n.type === 'ERROR' && n.titre === 'Ordre rejeté')).toBe(true);
    });
  });

  // ═══════════════════ cancelOrder ═════════════════════════════════════════

  describe('cancelOrder', () => {
    it('refuse un ordre qui n’est pas SOUMIS', () => {
      svc.orders.set([makeOrder({ status: 'EN_VERIFICATION' })]);
      expect(svc.cancelOrder('o1')).toBe(false);
    });

    it('refuse un ordre déjà imprimé par le SVT', () => {
      svc.orders.set([makeOrder({ printedBySvt: true })]);
      expect(svc.cancelOrder('o1')).toBe(false);
    });

    it('annule un ordre SOUMIS de manière optimiste et persiste', () => {
      svc.orders.set([makeOrder()]);
      expect(svc.cancelOrder('o1')).toBe(true);
      expect(svc.getOrder('o1')?.status).toBe('ANNULE');
      expect(api['cancelOrder']).toHaveBeenCalledWith('o1');
    });
  });

  // ═══════════════════ updateClientOrder ═══════════════════════════════════

  describe('updateClientOrder', () => {
    it('refuse un ordre non SOUMIS ou imprimé', () => {
      svc.orders.set([makeOrder({ status: 'ANNULE' })]);
      const got = vi.fn();
      svc.updateClientOrder('o1', { volume: 2 }).subscribe(got);
      expect(got).toHaveBeenCalledWith(false);
    });

    it('met à jour volume/taux et conserve le snapshot fourni', () => {
      svc.orders.set([makeOrder()]);
      const updated = makeOrder({ volume: 20, tauxSoumis: 6 });
      api['updateOrder'] = vi.fn(() => of(updated));
      const snap: any = { date: 'd' };
      const got = vi.fn();
      svc.updateClientOrder('o1', { volume: 20, taux: 6, formSnapshot: snap }).subscribe(got);

      expect(api['updateOrder']).toHaveBeenCalledWith('o1', { volume: 20, tauxSoumis: 6, signatureData: undefined });
      expect(got).toHaveBeenCalledWith(true);
      expect(svc.getOrder('o1')?.volume).toBe(20);
      expect(svc.getOrder('o1')?.formSnapshot).toBe(snap);
    });

    it('renvoie false si le backend échoue', () => {
      svc.orders.set([makeOrder()]);
      api['updateOrder'] = vi.fn(() => throwError(() => new Error('x')));
      const got = vi.fn();
      svc.updateClientOrder('o1', { volume: 20 }).subscribe(got);
      expect(got).toHaveBeenCalledWith(false);
    });
  });

  // ═══════════════════ printAndLockOrder / verifyProvision / transmitOrder ═

  describe('printAndLockOrder', () => {
    it('verrouille l’ordre, le transmet et journalise', () => {
      svc.orders.set([makeOrder()]);
      expect(svc.printAndLockOrder('o1', 'AG-1')).toBe(true);
      const o = svc.getOrder('o1')!;
      expect(o.printedBySvt).toBe(true);
      expect(o.printedBy).toBe('AG-1');
      expect(o.status).toBe('EN_ATTENTE_ADJUDICATION');
      expect(svc.audit().some((a) => a.action === 'IMPRESSION_LOCK_ORDRE')).toBe(true);
      expect(api['changeOrderStatus']).toHaveBeenCalled();
    });

    it('refuse un ordre déjà imprimé ou dans un mauvais statut', () => {
      svc.orders.set([makeOrder({ printedBySvt: true })]);
      expect(svc.printAndLockOrder('o1')).toBe(false);
      svc.orders.set([makeOrder({ status: 'ANNULE' })]);
      expect(svc.printAndLockOrder('o1')).toBe(false);
    });
  });

  describe('verifyProvision', () => {
    it('passe un ordre SOUMIS en EN_VERIFICATION', () => {
      svc.orders.set([makeOrder()]);
      expect(svc.verifyProvision('o1')).toBe(true);
      expect(svc.getOrder('o1')?.status).toBe('EN_VERIFICATION');
      expect(svc.audit().some((a) => a.action === 'VERIFICATION_PROVISION')).toBe(true);
    });

    it('refuse un ordre non SOUMIS', () => {
      svc.orders.set([makeOrder({ status: 'EN_VERIFICATION' })]);
      expect(svc.verifyProvision('o1')).toBe(false);
    });
  });

  describe('transmitOrder', () => {
    it('transmet un ordre EN_VERIFICATION au marché', () => {
      svc.orders.set([makeOrder({ status: 'EN_VERIFICATION' })]);
      expect(svc.transmitOrder('o1')).toBe(true);
      expect(svc.getOrder('o1')?.status).toBe('EN_ATTENTE_ADJUDICATION');
      expect(svc.audit().some((a) => a.action === 'TRANSMISSION_BEAC')).toBe(true);
    });

    it('refuse un ordre dans un statut incompatible', () => {
      svc.orders.set([makeOrder({ status: 'TOTALEMENT_RETENU' })]);
      expect(svc.transmitOrder('o1')).toBe(false);
    });
  });

  // ═══════════════════ saisirResultat ══════════════════════════════════════

  /** Le resultat est desormais rendu par le serveur : on lit la valeur emise. */
  function expectResultat(obs: Observable<boolean>, attendu: boolean) {
    let vu: boolean | undefined;
    obs.subscribe(v => { vu = v; });
    expect(vu).toBe(attendu);
  }

  describe('saisirResultat', () => {
    beforeEach(() => {
      svc.emissions.set([makeEmission()]);
      svc.orders.set([makeOrder()]);
    });

    it('refuse un ordre inconnu', () => {
      expectResultat(svc.saisirResultat('absent', 'TOTALEMENT_RETENU'), false);
    });

    it('exige un commentaire pour un résultat non totalement retenu', () => {
      expectResultat(svc.saisirResultat('o1', 'NON_RETENU'), false);
      expectResultat(svc.saisirResultat('o1', 'PARTIELLEMENT_RETENU', { montantPartiel: 1000 }), false);
    });

    it('alloue tout le volume pour TOTALEMENT_RETENU', () => {
      expectResultat(svc.saisirResultat('o1', 'TOTALEMENT_RETENU'), true);
      const o = svc.getOrder('o1')!;
      expect(o.status).toBe('TOTALEMENT_RETENU');
      expect(o.volumeAlloue).toBe(10);
      expect(o.montantDebite).toBe(100000);
      expect(svc.audit().some((a) => a.action === 'SAISIE_RESULTAT_TOTALEMENT_RETENU')).toBe(true);
    });

    it('calcule le volume alloué au prorata du montant partiel', () => {
      // valeurNominaleUnitaire = 10000 → 55000 borné, floor(55000/10000) = 5
      expectResultat(svc.saisirResultat('o1', 'PARTIELLEMENT_RETENU', { montantPartiel: 55000, commentaire: 'partiel' }), true);
      const o = svc.getOrder('o1')!;
      expect(o.montantDebite).toBe(55000);
      expect(o.volumeAlloue).toBe(5);
      expect(o.commentaireResultat).toBe('partiel');
    });

    it('borne le montant partiel au montant de l’ordre', () => {
      // Le résultat n'est appliqué qu'une fois le serveur d'accord : il faut donc
      // s'abonner (l'observable est froid), sinon aucun appel n'est émis.
      expectResultat(
        svc.saisirResultat('o1', 'PARTIELLEMENT_RETENU', { montantPartiel: 999999, commentaire: 'plafonné' }),
        true);
      expect(svc.getOrder('o1')?.montantDebite).toBe(100000);
    });

    it('remet à zéro les allocations pour NON_RETENU', () => {
      expectResultat(svc.saisirResultat('o1', 'NON_RETENU', { commentaire: 'refusé' }), true);
      const o = svc.getOrder('o1')!;
      expect(o.status).toBe('NON_RETENU');
      expect(o.volumeAlloue).toBe(0);
      expect(o.montantDebite).toBe(0);
    });
  });

  // ═══════════════════ validate/reject Order (Observable) ══════════════════

  describe('validateOrder / rejectOrder', () => {
    it('validateOrder renvoie true et resynchronise', () => {
      svc.orders.set([makeOrder()]);
      const got = vi.fn();
      svc.validateOrder('o1').subscribe(got);
      expect(got).toHaveBeenCalledWith(true);
      expect(api['validateOrder']).toHaveBeenCalledWith('o1');
      expect(api['listOrders']).toHaveBeenCalled();
    });

    it('validateOrder renvoie false sur erreur', () => {
      api['validateOrder'] = vi.fn(() => throwError(() => new Error('x')));
      const got = vi.fn();
      svc.validateOrder('o1').subscribe(got);
      expect(got).toHaveBeenCalledWith(false);
    });

    it('rejectOrder exige un motif non vide', () => {
      const got = vi.fn();
      svc.rejectOrder('o1', '   ').subscribe(got);
      expect(got).toHaveBeenCalledWith(false);
      expect(api['rejectOrder']).not.toHaveBeenCalled();
    });

    it('rejectOrder transmet le motif nettoyé', () => {
      const got = vi.fn();
      svc.rejectOrder('o1', '  motif  ').subscribe(got);
      expect(api['rejectOrder']).toHaveBeenCalledWith('o1', 'motif');
      expect(got).toHaveBeenCalledWith(true);
    });
  });

  describe('bulkValidateOrders / bulkRejectOrders', () => {
    it('bulkValidateOrders sur liste vide renvoie 0/0 sans appel', () => {
      const got = vi.fn();
      svc.bulkValidateOrders([]).subscribe(got);
      expect(got).toHaveBeenCalledWith({ ok: 0, ko: 0 });
    });

    it('bulkValidateOrders compte succès et échecs', () => {
      api['validateOrder'] = vi.fn((id: string) => (id === 'bad' ? throwError(() => new Error('x')) : of(makeOrder())));
      const got = vi.fn();
      svc.bulkValidateOrders(['o1', 'bad']).subscribe(got);
      expect(got).toHaveBeenCalledWith({ ok: 1, ko: 1 });
    });

    it('bulkRejectOrders sans motif renvoie tout en échec', () => {
      const got = vi.fn();
      svc.bulkRejectOrders(['o1', 'o2'], '  ').subscribe(got);
      expect(got).toHaveBeenCalledWith({ ok: 0, ko: 2 });
    });

    it('bulkRejectOrders compte les succès', () => {
      const got = vi.fn();
      svc.bulkRejectOrders(['o1', 'o2'], 'motif').subscribe(got);
      expect(got).toHaveBeenCalledWith({ ok: 2, ko: 0 });
    });
  });

  // ═══════════════════ superviseur : résultat / notes / signature ══════════

  it('validateOrderResult délègue au backend et resynchronise', () => {
    svc.validateOrderResult('o1');
    expect(api['validateOrderResult']).toHaveBeenCalledWith('o1');
    expect(api['listOrders']).toHaveBeenCalled();
  });

  it('rejectOrderResult délègue au backend avec motif', () => {
    svc.rejectOrderResult('o1', 'non conforme');
    expect(api['rejectOrderResult']).toHaveBeenCalledWith('o1', 'non conforme');
  });

  it('addOrderNote met à jour localement et persiste', () => {
    svc.orders.set([makeOrder()]);
    svc.addOrderNote('o1', 'à surveiller');
    expect(svc.getOrder('o1')?.notes).toBe('à surveiller');
    expect(api['setOrderNotes']).toHaveBeenCalledWith('o1', 'à surveiller');
  });

  it('getOrderHistory filtre l’audit sur la référence', () => {
    svc.orders.set([makeOrder()]);
    svc.verifyProvision('o1'); // journalise sur la référence ORD-2026-000001
    expect(svc.getOrderHistory('ORD-2026-000001').length).toBeGreaterThan(0);
    expect(svc.getOrderHistory('ORD-inconnu')).toEqual([]);
  });

  describe('verifyOrderSignature', () => {
    it('ne fait rien pour un ordre inconnu', () => {
      svc.verifyOrderSignature('absent', true);
      expect(api['verifyOrderSignature']).not.toHaveBeenCalled();
    });

    it('marque la signature vérifiée et persiste', () => {
      svc.orders.set([makeOrder()]);
      svc.verifyOrderSignature('o1', true);
      expect(svc.getOrder('o1')?.signatureVerified).toBe(true);
      expect(api['verifyOrderSignature']).toHaveBeenCalledWith('o1', true);
    });
  });

  // ═══════════════════ changeOrderStatus ═══════════════════════════════════

  describe('changeOrderStatus', () => {
    beforeEach(() => {
      svc.emissions.set([makeEmission()]);
      svc.orders.set([makeOrder()]);
    });

    it('refuse un ordre inconnu ou un statut identique', () => {
      expect(svc.changeOrderStatus('absent', 'ANNULE')).toBe(false);
      expect(svc.changeOrderStatus('o1', 'SOUMIS')).toBe(false);
    });

    it('renseigne les allocations pour un statut retenu et notifie', () => {
      expect(svc.changeOrderStatus('o1', 'TOTALEMENT_RETENU')).toBe(true);
      const o = svc.getOrder('o1')!;
      expect(o.status).toBe('TOTALEMENT_RETENU');
      expect(o.volumeAlloue).toBe(10);
      expect(o.montantDebite).toBe(100000); // 10 * valeurNominaleUnitaire
      expect(svc.notifications().length).toBeGreaterThan(0);
      expect(svc.audit().some((a) => a.action === 'CHANGEMENT_STATUT_TOTALEMENT_RETENU')).toBe(true);
    });

    it('remet les allocations à zéro pour NON_RETENU', () => {
      expect(svc.changeOrderStatus('o1', 'NON_RETENU')).toBe(true);
      const o = svc.getOrder('o1')!;
      expect(o.volumeAlloue).toBe(0);
      expect(o.montantDebite).toBe(0);
    });
  });

  // ═══════════════════ Émissions — création / édition ══════════════════════

  describe('createEmission', () => {
    it('crée une fiche en brouillon et recharge sans notifier', () => {
      api['createEmission'] = vi.fn(() => of(makeEmission({ status: 'BROUILLON' })));
      const got = vi.fn();
      svc.createEmission({ code: 'BTA-CMR-26-02' }).subscribe(got);
      expect(api['createEmission']).toHaveBeenCalled();
      expect(api['listEmissions']).toHaveBeenCalled();
      expect(got).toHaveBeenCalled();
      expect(svc.notifications()).toEqual([]);
    });

    it('publie immédiatement et notifie quand publish=true', () => {
      api['createEmission'] = vi.fn(() => of(makeEmission({ id: 'emP', status: 'BROUILLON' })));
      api['publishEmission'] = vi.fn(() => of(makeEmission({ id: 'emP', status: 'PUBLIE' })));
      const got = vi.fn();
      svc.createEmission({ code: 'BTA-CMR-26-03' }, true).subscribe(got);
      expect(api['publishEmission']).toHaveBeenCalledWith('emP');
      expect(svc.notifications().some((n) => n.titre === 'Nouvelle émission publiée')).toBe(true);
    });

    it('renvoie null en cas d’échec backend', () => {
      api['createEmission'] = vi.fn(() => throwError(() => new Error('x')));
      const got = vi.fn();
      svc.createEmission({ code: 'X' }).subscribe(got);
      expect(got).toHaveBeenCalledWith(null);
    });
  });

  describe('editEmission', () => {
    it('renvoie l’émission mise à jour et recharge', () => {
      const em = makeEmission({ libelle: 'Modifié' });
      api['updateEmission'] = vi.fn(() => of(em));
      const got = vi.fn();
      svc.editEmission('em1', { libelle: 'Modifié' }).subscribe(got);
      expect(got).toHaveBeenCalledWith(em);
      expect(api['listEmissions']).toHaveBeenCalled();
    });

    it('renvoie null sur erreur', () => {
      api['updateEmission'] = vi.fn(() => throwError(() => new Error('x')));
      const got = vi.fn();
      svc.editEmission('em1', {}).subscribe(got);
      expect(got).toHaveBeenCalledWith(null);
    });
  });

  describe('validateAndPublishEmission', () => {
    it('publie une fiche BROUILLON et journalise', () => {
      svc.emissions.set([makeEmission({ status: 'BROUILLON' })]);
      expect(svc.validateAndPublishEmission('em1', 'SUP-1')).toBe(true);
      const e = svc.getEmission('em1')!;
      expect(e.status).toBe('PUBLIE');
      expect(e.validatedBy).toBe('SUP-1');
      expect(api['publishEmission']).toHaveBeenCalledWith('em1');
      expect(svc.audit().some((a) => a.action === 'VALIDATION_PUBLICATION_EMISSION')).toBe(true);
    });

    it('refuse une fiche non brouillon', () => {
      svc.emissions.set([makeEmission({ status: 'PUBLIE' })]);
      expect(svc.validateAndPublishEmission('em1')).toBe(false);
    });
  });

  describe('rejectEmissionValidation', () => {
    it('refuse sans motif', () => {
      svc.emissions.set([makeEmission({ status: 'BROUILLON' })]);
      expect(svc.rejectEmissionValidation('em1', '  ')).toBe(false);
    });

    it('enregistre le motif de rejet et journalise en échec', () => {
      svc.emissions.set([makeEmission({ status: 'BROUILLON' })]);
      expect(svc.rejectEmissionValidation('em1', 'Champs manquants', 'SUP-1')).toBe(true);
      const e = svc.getEmission('em1')!;
      expect(e.rejectionMotif).toBe('Champs manquants');
      expect(e.rejectedBy).toBe('SUP-1');
      expect(svc.audit().some((a) => a.action === 'REFUS_VALIDATION_EMISSION' && a.resultat === 'ECHEC')).toBe(true);
    });

    it('refuse une fiche non brouillon', () => {
      svc.emissions.set([makeEmission({ status: 'PUBLIE' })]);
      expect(svc.rejectEmissionValidation('em1', 'motif')).toBe(false);
    });
  });

  describe('bulk émissions', () => {
    it('bulkValidateAndPublishEmissions compte succès et échecs', () => {
      svc.emissions.set([makeEmission({ id: 'a', status: 'BROUILLON' }), makeEmission({ id: 'b', status: 'PUBLIE' })]);
      expect(svc.bulkValidateAndPublishEmissions(['a', 'b'])).toEqual({ ok: 1, ko: 1 });
    });

    it('bulkRejectEmissions compte succès et échecs', () => {
      svc.emissions.set([makeEmission({ id: 'a', status: 'BROUILLON' }), makeEmission({ id: 'b', status: 'PUBLIE' })]);
      expect(svc.bulkRejectEmissions(['a', 'b'], 'motif')).toEqual({ ok: 1, ko: 1 });
    });
  });

  describe('publishAllEmissions', () => {
    it('recharge et journalise quand des fiches sont publiées', () => {
      api['publishAllEmissions'] = vi.fn(() => of({ published: 3, codes: ['a', 'b', 'c'] }));
      const got = vi.fn();
      svc.publishAllEmissions().subscribe(got);
      expect(got).toHaveBeenCalledWith(3);
      expect(api['listEmissions']).toHaveBeenCalled();
      expect(svc.audit().some((a) => a.action === 'PUBLICATION_GROUPEE_EMISSIONS')).toBe(true);
    });

    it('ne recharge pas si aucune fiche publiée', () => {
      api['publishAllEmissions'] = vi.fn(() => of({ published: 0, codes: [] }));
      // Neutralise l'appel d'hydratation différé du constructeur (queueMicrotask).
      (api['listEmissions'] as any).mockClear();
      const got = vi.fn();
      svc.publishAllEmissions().subscribe(got);
      expect(got).toHaveBeenCalledWith(0);
      expect(api['listEmissions']).not.toHaveBeenCalled();
    });

    it('renvoie 0 sur erreur', () => {
      api['publishAllEmissions'] = vi.fn(() => throwError(() => new Error('x')));
      const got = vi.fn();
      svc.publishAllEmissions().subscribe(got);
      expect(got).toHaveBeenCalledWith(0);
    });
  });

  describe('duplicateEmission', () => {
    it('clone une fiche en brouillon avec code/isin dérivés', () => {
      svc.emissions.set([makeEmission({ code: 'BTA-CMR-26-01', isin: 'CM0000000001' })]);
      const clone = svc.duplicateEmission('em1')!;
      expect(clone.code).toBe('BTA-CMR-26-01-COPY');
      expect(clone.isin).toBe('CM00000000010');
      expect(clone.status).toBe('BROUILLON');
      expect(svc.emissions()[0].id).toBe(clone.id);
      expect(svc.audit().some((a) => a.action === 'DUPLICATION_EMISSION')).toBe(true);
    });

    it('renvoie null pour un id inconnu', () => {
      expect(svc.duplicateEmission('absent')).toBeNull();
    });
  });

  describe('archiveEmission / closeEmission', () => {
    it('archive une fiche clôturée', () => {
      svc.emissions.set([makeEmission({ status: 'CLOTURE' })]);
      expect(svc.archiveEmission('em1')).toBe(true);
      expect(svc.getEmission('em1')?.status).toBe('ARCHIVE');
      expect(api['archiveEmission']).toHaveBeenCalledWith('em1');
    });

    it('refuse d’archiver une fiche non clôturée', () => {
      svc.emissions.set([makeEmission({ status: 'PUBLIE' })]);
      expect(svc.archiveEmission('em1')).toBe(false);
    });

    it('clôture une fiche publiée', () => {
      svc.emissions.set([makeEmission({ status: 'PUBLIE' })]);
      expect(svc.closeEmission('em1')).toBe(true);
      expect(svc.getEmission('em1')?.status).toBe('CLOTURE');
    });

    it('refuse de clôturer une fiche non publiée', () => {
      svc.emissions.set([makeEmission({ status: 'BROUILLON' })]);
      expect(svc.closeEmission('em1')).toBe(false);
    });
  });

  it('getEmissionHistory filtre l’audit sur le code émission', () => {
    svc.emissions.set([makeEmission({ status: 'CLOTURE', code: 'BTA-CMR-26-01' })]);
    svc.archiveEmission('em1');
    expect(svc.getEmissionHistory('BTA-CMR-26-01').length).toBeGreaterThan(0);
    expect(svc.getEmissionHistory('AUTRE')).toEqual([]);
  });

  describe('updateEmission (local) / deleteEmission', () => {
    it('journalise un retour en brouillon distinctement', () => {
      svc.emissions.set([makeEmission({ status: 'PUBLIE', code: 'BTA-CMR-26-01' })]);
      svc.updateEmission('em1', { status: 'BROUILLON' });
      expect(svc.getEmission('em1')?.status).toBe('BROUILLON');
      expect(svc.audit().some((a) => a.action === 'MAJ_EMISSION_RETOUR_BROUILLON')).toBe(true);
    });

    it('journalise une mise à jour ordinaire', () => {
      svc.emissions.set([makeEmission({ status: 'BROUILLON' })]);
      svc.updateEmission('em1', { libelle: 'X' });
      expect(svc.audit().some((a) => a.action === 'MAJ_EMISSION')).toBe(true);
    });

    it('supprime une fiche et journalise', () => {
      svc.emissions.set([makeEmission()]);
      svc.deleteEmission('em1');
      expect(svc.getEmission('em1')).toBeUndefined();
      expect(svc.audit().some((a) => a.action === 'SUPPRESSION_EMISSION')).toBe(true);
    });
  });

  // ═══════════════════ runAdjudication ═════════════════════════════════════

  describe('runAdjudication', () => {
    it('ne fait rien pour une émission inconnue', () => {
      svc.runAdjudication('absent');
      expect(svc.audit()).toEqual([]);
    });

    it('applique les résultats selon le taux et clôture l’émission', () => {
      svc.emissions.set([makeEmission({ tauxNominal: 5, valeurNominaleUnitaire: 10000 })]);
      svc.orders.set([
        makeOrder({ id: 'oA', tauxSoumis: 4, volume: 10 }),   // < marginal → totalement
        makeOrder({ id: 'oB', tauxSoumis: 5, volume: 10 }),   // ≈ marginal → partiellement (alloc 6)
        makeOrder({ id: 'oC', tauxSoumis: 6, volume: 10 }),   // > marginal → non retenu
      ]);
      svc.runAdjudication('em1');

      expect(svc.getOrder('oA')?.status).toBe('TOTALEMENT_RETENU');
      expect(svc.getOrder('oB')?.status).toBe('PARTIELLEMENT_RETENU');
      expect(svc.getOrder('oB')?.volumeAlloue).toBe(6);
      expect(svc.getOrder('oC')?.status).toBe('NON_RETENU');
      expect(svc.getEmission('em1')?.status).toBe('CLOTURE');
      expect(svc.audit().some((a) => a.action === 'ADJUDICATION_EXECUTEE')).toBe(true);
    });
  });

  // ═══════════════════ createClientDossier ═════════════════════════════════

  describe('createClientDossier', () => {
    const base = {
      type: 'PP' as const, raisonSociale: 'Client Test', categorie: 'NON_QUALIFIE' as const,
      typeCompte: 'INDIVIDUEL' as const,
      adresse: { type: 'DOMICILE' as const, rue: 'r', ville: 'Douala', pays: 'CMR' },
      signataires: [makeContact()],
      sousComptes: [makeSousCompte('SC-1')],
    };

    function run(input: any) {
      const got = vi.fn();
      svc.createClientDossier(input).subscribe(got);
      return got;
    }

    it('refuse une raison sociale vide', () => {
      const got = run({ ...base, raisonSociale: '  ' });
      expect(got).toHaveBeenCalledWith({ ok: false, error: 'Raison sociale requise.' });
    });

    it('refuse l’absence de signataire', () => {
      const got = run({ ...base, signataires: [] });
      expect(got.mock.calls[0][0].ok).toBe(false);
    });

    it('refuse une PP à plusieurs signataires', () => {
      const got = run({ ...base, signataires: [makeContact(), makeContact({ id: 's2' })] });
      expect(got.mock.calls[0][0].error).toContain('un seul signataire');
    });

    it('refuse une PM avec plus de 4 signataires', () => {
      const got = run({
        ...base, type: 'PM', signataires: Array.from({ length: 5 }, (_, i) => makeContact({ id: `s${i}` })),
      });
      expect(got.mock.calls[0][0].error).toContain('1 à 4');
    });

    it('refuse une PP sans exactement un sous-compte', () => {
      const got = run({ ...base, sousComptes: [] });
      expect(got.mock.calls[0][0].error).toContain('un seul sous-compte');
    });

    it('refuse une PM sans sous-compte', () => {
      const got = run({ ...base, type: 'PM', sousComptes: [] });
      expect(got.mock.calls[0][0].error).toContain('au moins un sous-compte');
    });

    it('refuse des numéros de sous-comptes non uniques', () => {
      const got = run({ ...base, type: 'PM', sousComptes: [makeSousCompte('SC-1'), makeSousCompte('SC-1')] });
      expect(got.mock.calls[0][0].error).toContain('non uniques');
    });

    it('crée le dossier et recharge le registre en cas de succès', () => {
      const dossier = makeDossier({ id: 'cNew' });
      api['createClient'] = vi.fn(() => of(dossier));
      const got = run(base);
      expect(api['createClient']).toHaveBeenCalled();
      expect(got).toHaveBeenCalledWith({ ok: true, client: dossier });
      expect(api['listClientDossiers']).toHaveBeenCalled();
    });

    it('renvoie un message d’erreur générique si le backend échoue', () => {
      api['createClient'] = vi.fn(() => throwError(() => new Error('duplicate email')));
      const got = run(base);
      expect(got.mock.calls[0][0].ok).toBe(false);
      expect(got.mock.calls[0][0].error).toContain('Création impossible');
    });
  });

  // ═══════════════════ Documents ═══════════════════════════════════════════

  describe('generateAttestation', () => {
    /** Livrable tel que le serveur le renvoie : référence et taille faites en base. */
    const persisted = {
      id: 'd-srv-1', reference: 'DOC-20260714-000042', type: 'ATTESTATION_PROPRIETE',
      titre: 'Attestation de propriété de titres', clientId: 'U123', clientNom: 'Doe John',
      uploadedBy: 'U123', mimeType: 'application/pdf', taille: '18 Ko',
      telechargements: 0, dateGeneration: '2026-07-14',
    };

    it("délègue l'édition au serveur, sans transmettre de contenu", () => {
      api['generateAttestation'] = vi.fn(() => of(persisted));
      svc.generateAttestation().subscribe();
      expect(api['generateAttestation']).toHaveBeenCalledWith();
    });

    it('insère le livrable renvoyé par la base et journalise', () => {
      api['generateAttestation'] = vi.fn(() => of(persisted));
      svc.generateAttestation().subscribe();
      const doc = svc.documents()[0];
      expect(doc.reference).toBe('DOC-20260714-000042');
      expect(doc.mimeType).toBe('application/pdf');
      expect(svc.audit().some((a) => a.action === 'GENERATION_LIVRABLE')).toBe(true);
    });

    it("n'ajoute aucun livrable si le serveur refuse", () => {
      api['generateAttestation'] = vi.fn(() => throwError(() => new Error('sans objet')));
      svc.generateAttestation().subscribe({ error: () => undefined });
      expect(svc.documents()).toHaveLength(0);
    });
  });

  it('logDocumentDownload incrémente le compteur et journalise', () => {
    svc.documents.set([{
      id: 'd1', reference: 'DOC-20260714-000001', type: 'AVIS_OPERATION',
      titre: "Avis d'opération", clientId: 'C1', clientNom: '', uploadedBy: 'C1',
      mimeType: 'application/pdf', taille: '12 Ko', telechargements: 0,
      dateGeneration: '2026-07-14',
    }]);
    svc.logDocumentDownload('d1');
    expect(svc.documents().find((d) => d.id === 'd1')?.telechargements).toBe(1);
    expect(svc.audit().some((a) => a.action === 'TELECHARGEMENT_DOCUMENT')).toBe(true);
  });

  // ═══════════════════ marcheConfig / marcheEmissions ══════════════════════

  describe('marcheEmissions (computed) & updateMarcheConfig', () => {
    it('ne retient que les statuts configurés et masque les souscriptions fermées', () => {
      svc.emissions.set([
        makeEmission({ id: 'pub', status: 'PUBLIE', fermetureSouscription: '2999-01-01 00:00' }),
        makeEmission({ id: 'brou', status: 'BROUILLON' }),
        makeEmission({ id: 'ferme', status: 'PUBLIE', fermetureSouscription: '2000-01-01 00:00' }),
      ]);
      const ids = svc.marcheEmissions().map((e) => e.id);
      expect(ids).toContain('pub');
      expect(ids).not.toContain('brou');
      expect(ids).not.toContain('ferme');
    });

    it('updateMarcheConfig fusionne le patch, persiste et journalise', () => {
      svc.updateMarcheConfig({ statuses: ['PUBLIE', 'CLOTURE'] });
      expect(svc.marcheConfig().statuses).toEqual(['PUBLIE', 'CLOTURE']);
      expect(api['updateMarcheConfig']).toHaveBeenCalled();
      expect(svc.audit().some((a) => a.action === 'CONFIG_AFFICHAGE_MARCHE')).toBe(true);
    });
  });
});
