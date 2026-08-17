import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { ApiService } from './api';
import { environment } from '../../../environments/environment';

const API = environment.apiBaseUrl;

/** Reproduit la conversion horodatage → affichage local du service (tz-indépendant). */
function expectedLocal(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Page backend générique. */
function page<T>(data: T[]): { data: T[]; page: number; size: number; total: number } {
  return { data, page: 1, size: 100, total: data.length };
}

describe('ApiService', () => {
  let api: ApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), ApiService],
    });
    api = TestBed.inject(ApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });
  afterEach(() => httpMock.verify());

  /** Attend la seule requête vers `path` (chemin sans query) avec le verbe donné. */
  function expectReq(method: string, path: string): TestRequest {
    return httpMock.expectOne((r) => r.method === method && r.url === `${API}${path}`);
  }

  // ─────────────────────────────── Émissions ─────────────────────────────────

  describe('émissions', () => {
    it('listEmissions appelle GET et convertit les dates d’affichage', () => {
      const res = vi.fn();
      api.listEmissions().subscribe(res);
      const req = expectReq('GET', '/emissions?size=100');
      req.flush(page([
        { id: 'e1', ouvertureSouscription: '2026-05-05T08:00:00', fermetureSouscription: '2026-05-12T09:00:00' },
      ]));
      expect(res.mock.calls[0][0][0]).toMatchObject({
        id: 'e1',
        ouvertureSouscription: '2026-05-05 08:00',
        fermetureSouscription: '2026-05-12 09:00',
      });
    });

    it('convertit un horodatage UTC en heure LOCALE d’affichage', () => {
      const res = vi.fn();
      api.listEmissions().subscribe(res);
      const req = expectReq('GET', '/emissions?size=100');
      req.flush(page([{ id: 'e1', ouvertureSouscription: '2026-05-11T08:00:00Z', fermetureSouscription: '2026-05-11T09:00:00Z' }]));
      expect(res.mock.calls[0][0][0].ouvertureSouscription).toBe(expectedLocal('2026-05-11T08:00:00Z'));
    });

    it('createEmission poste le corps en convertissant les fenêtres au format RFC 3339', () => {
      api.createEmission({
        code: 'C', isin: 'I', libelle: 'L', nature: 'BTA', paysCode: 'CMR',
        dateEmission: '2026-05-01', ouvertureSouscription: '2026-05-05T08:00',
        fermetureSouscription: '2026-05-12 09:00', dateEcheance: '2027-05-19',
        dateReglement: '2026-05-01', valeurNominaleUnitaire: 1, montantGlobal: 10,
        montantMinimum: 1, modeAdjudication: 'HOLLANDAISE',
      } as any).subscribe();
      const req = expectReq('POST', '/emissions');
      expect(req.request.body.ouvertureSouscription).toBe('2026-05-05T08:00:00Z');
      expect(req.request.body.fermetureSouscription).toBe('2026-05-12T09:00:00Z');
      req.flush({ id: 'e1', ouvertureSouscription: '2026-05-05T08:00:00', fermetureSouscription: '2026-05-12T09:00:00' });
    });

    it('toRfc3339 laisse intacte une date simple sans heure', () => {
      api.createEmission({
        code: 'C', ouvertureSouscription: '2026-05-05', fermetureSouscription: '2026-05-12',
      } as any).subscribe();
      const req = expectReq('POST', '/emissions');
      expect(req.request.body.ouvertureSouscription).toBe('2026-05-05');
      expect(req.request.body.fermetureSouscription).toBe('2026-05-12');
      req.flush({ id: 'e1' });
    });

    it('toRfc3339 conserve un horodatage déjà complet', () => {
      api.createEmission({
        code: 'C', ouvertureSouscription: '2026-05-05T08:00:00Z', fermetureSouscription: '2026-05-12T09:00:00+01:00',
      } as any).subscribe();
      const req = expectReq('POST', '/emissions');
      expect(req.request.body.ouvertureSouscription).toBe('2026-05-05T08:00:00Z');
      expect(req.request.body.fermetureSouscription).toBe('2026-05-12T09:00:00+01:00');
      req.flush({ id: 'e1' });
    });

    it('publishEmission poste sur l’endpoint publish', () => {
      api.publishEmission('e1').subscribe();
      const req = expectReq('POST', '/emissions/e1/publish');
      expect(req.request.body).toEqual({});
      req.flush({ id: 'e1' });
    });

    it('publishAllEmissions renvoie le résumé backend', () => {
      const res = vi.fn();
      api.publishAllEmissions().subscribe(res);
      const req = expectReq('POST', '/emissions/publish-all');
      req.flush({ published: 3, codes: ['A', 'B', 'C'] });
      expect(res).toHaveBeenCalledWith({ published: 3, codes: ['A', 'B', 'C'] });
    });

    it('updateEmission émet un PATCH avec les fenêtres normalisées', () => {
      api.updateEmission('e1', {
        code: 'C', ouvertureSouscription: '2026-05-05T08:00', fermetureSouscription: '2026-05-12T09:00',
      } as any).subscribe();
      const req = expectReq('PATCH', '/emissions/e1');
      expect(req.request.body.ouvertureSouscription).toBe('2026-05-05T08:00:00Z');
      req.flush({ id: 'e1' });
    });

    it('rejectEmission transmet le motif', () => {
      api.rejectEmission('e1', 'incomplet').subscribe();
      const req = expectReq('POST', '/emissions/e1/reject');
      expect(req.request.body).toEqual({ motif: 'incomplet' });
      req.flush({ id: 'e1' });
    });

    it('closeEmission et archiveEmission ciblent leurs endpoints', () => {
      api.closeEmission('e1').subscribe();
      expectReq('POST', '/emissions/e1/close').flush({ id: 'e1' });
      api.archiveEmission('e1').subscribe();
      expectReq('POST', '/emissions/e1/archive').flush({ id: 'e1' });
    });

    it('broadcastEmissions envoie une liste vide par défaut', () => {
      const res = vi.fn();
      api.broadcastEmissions().subscribe(res);
      const req = expectReq('POST', '/emissions/broadcast');
      expect(req.request.body).toEqual({ recipients: [] });
      req.flush({ recipientsCount: 0, emissionsCount: 2, status: 'SIMULATED' });
      expect(res).toHaveBeenCalledWith({ recipientsCount: 0, emissionsCount: 2, status: 'SIMULATED' });
    });

    it('broadcastEmissions transmet les destinataires fournis', () => {
      api.broadcastEmissions(['a@b.cm']).subscribe();
      const req = expectReq('POST', '/emissions/broadcast');
      expect(req.request.body).toEqual({ recipients: ['a@b.cm'] });
      req.flush({ recipientsCount: 1, emissionsCount: 1, status: 'SENT' });
    });

    it('broadcastRecipients extrait la liste d’e-mails et tolère l’absence', () => {
      const res = vi.fn();
      api.broadcastRecipients().subscribe(res);
      expectReq('GET', '/emissions/broadcast/recipients').flush({ emails: ['a@b.cm'] });
      expect(res).toHaveBeenCalledWith(['a@b.cm']);

      const res2 = vi.fn();
      api.broadcastRecipients().subscribe(res2);
      expectReq('GET', '/emissions/broadcast/recipients').flush({});
      expect(res2).toHaveBeenCalledWith([]);
    });

    it('propage une erreur HTTP au souscripteur', () => {
      const onError = vi.fn();
      api.listEmissions().subscribe({ error: onError });
      expectReq('GET', '/emissions?size=100').flush({}, { status: 500, statusText: 'Server Error' });
      expect(onError).toHaveBeenCalledOnce();
    });
  });

  // ─────────────────────────────── Portefeuille ──────────────────────────────

  describe('portefeuille', () => {
    it('listPortfolio renvoie le portefeuille tel quel', () => {
      const res = vi.fn();
      api.listPortfolio().subscribe(res);
      const body = { clientId: 'c1', positions: [], lignesActives: 0, valeurTotale: 0, soldeEspeces: null };
      expectReq('GET', '/portfolio').flush(body);
      expect(res).toHaveBeenCalledWith(body);
    });

    it('importPortfolioRows poste les lignes dans une enveloppe rows', () => {
      const rows = [{ isin: 'X', volume: 1 }] as any;
      api.importPortfolioRows(rows).subscribe();
      const req = expectReq('POST', '/portfolio/import');
      expect(req.request.body).toEqual({ rows });
      req.flush({ imported: 1, errors: [] });
    });
  });

  // ────────────────────────────────── Clients ────────────────────────────────

  describe('clients', () => {
    it('listClientDossiers convertit createdAt de chaque dossier', () => {
      const res = vi.fn();
      api.listClientDossiers().subscribe(res);
      expectReq('GET', '/clients/dossiers?size=100').flush(page([{ id: 'c1', createdAt: '2026-05-05T08:00:00' }]));
      expect(res.mock.calls[0][0][0]).toMatchObject({ id: 'c1', createdAt: '2026-05-05 08:00' });
    });

    it('getMyDossier convertit createdAt', () => {
      const res = vi.fn();
      api.getMyDossier().subscribe(res);
      expectReq('GET', '/clients/me').flush({ id: 'c1', createdAt: '2026-05-05T08:00:00' });
      expect(res.mock.calls[0][0]).toMatchObject({ createdAt: '2026-05-05 08:00' });
    });

    it('createClient poste le corps', () => {
      const body = { type: 'PP', raisonSociale: 'ACME' } as any;
      api.createClient(body).subscribe();
      const req = expectReq('POST', '/clients');
      expect(req.request.body).toEqual(body);
      req.flush({ id: 'c1', createdAt: '2026-05-05T08:00:00' });
    });

    it('updateClient émet un PATCH ciblé', () => {
      api.updateClient('c1', { raisonSociale: 'ACME 2' }).subscribe();
      const req = expectReq('PATCH', '/clients/c1');
      expect(req.request.body).toEqual({ raisonSociale: 'ACME 2' });
      req.flush({ id: 'c1', createdAt: '2026-05-05T08:00:00' });
    });

    it('deactivateClient émet un DELETE', () => {
      api.deactivateClient('c1').subscribe();
      expectReq('DELETE', '/clients/c1').flush({ id: 'c1', createdAt: '2026-05-05T08:00:00' });
    });

    it('listClients renvoie les comptes de la page', () => {
      const res = vi.fn();
      api.listClients().subscribe(res);
      expectReq('GET', '/clients?size=100').flush(page([{ id: 'c1' }, { id: 'c2' }]));
      expect(res.mock.calls[0][0]).toHaveLength(2);
    });
  });

  // ───────────────────────────────── Permissions ─────────────────────────────

  describe('permissions RBAC', () => {
    it('listRolePermissions renvoie la matrice', () => {
      const res = vi.fn();
      api.listRolePermissions().subscribe(res);
      expectReq('GET', '/permissions').flush({ ADMIN: ['ALL'] });
      expect(res).toHaveBeenCalledWith({ ADMIN: ['ALL'] });
    });

    it('setRolePermission émet un PUT avec role/permission/granted', () => {
      api.setRolePermission('AGENT', 'ORDER_VALIDATE', true).subscribe();
      const req = expectReq('PUT', '/permissions');
      expect(req.request.body).toEqual({ role: 'AGENT', permission: 'ORDER_VALIDATE', granted: true });
      req.flush({});
    });
  });

  // ─────────────────────────────────── Ordres ────────────────────────────────

  describe('ordres', () => {
    it('listOrders convertit dateSoumission et updatedAt', () => {
      const res = vi.fn();
      api.listOrders().subscribe(res);
      expectReq('GET', '/orders?size=100').flush(page([
        { id: 'o1', dateSoumission: '2026-06-15T09:00:00', updatedAt: '2026-06-16T10:00:00' },
      ]));
      expect(res.mock.calls[0][0][0]).toMatchObject({
        dateSoumission: '2026-06-15 09:00', updatedAt: '2026-06-16 10:00',
      });
    });

    it('createOrder poste le corps et mappe la réponse', () => {
      const body = { emissionId: 'e1', volume: 10, tauxSoumis: 5.8 };
      api.createOrder(body).subscribe();
      const req = expectReq('POST', '/orders');
      expect(req.request.body).toEqual(body);
      req.flush({ id: 'o1', dateSoumission: '2026-06-15T09:00:00' });
    });

    it('updateOrder émet un PATCH', () => {
      api.updateOrder('o1', { volume: 5, tauxSoumis: 6 }).subscribe();
      const req = expectReq('PATCH', '/orders/o1');
      expect(req.request.body).toEqual({ volume: 5, tauxSoumis: 6 });
      req.flush({ id: 'o1', dateSoumission: '2026-06-15T09:00:00' });
    });

    it('cancelOrder, validateOrder et validateOrderResult postent un corps vide', () => {
      api.cancelOrder('o1').subscribe();
      expectReq('POST', '/orders/o1/cancel').flush({ id: 'o1', dateSoumission: '2026-06-15T09:00:00' });
      api.validateOrder('o1').subscribe();
      expectReq('POST', '/orders/o1/validate').flush({ id: 'o1', dateSoumission: '2026-06-15T09:00:00' });
      api.validateOrderResult('o1').subscribe();
      expectReq('POST', '/orders/o1/validate-result').flush({ id: 'o1', dateSoumission: '2026-06-15T09:00:00' });
    });

    it('listPendingCoSignatures renvoie les opérations à cosigner', () => {
      const res = vi.fn();
      api.listPendingCoSignatures().subscribe(res);
      expectReq('GET', '/orders/cosignatures/pending').flush([{ orderId: 'o1' }]);
      expect(res.mock.calls[0][0]).toHaveLength(1);
    });

    it('coSignOrder transmet la décision d’approbation', () => {
      api.coSignOrder('o1', false).subscribe();
      const req = expectReq('POST', '/orders/o1/cosign');
      expect(req.request.body).toEqual({ approve: false });
      req.flush({ id: 'o1', dateSoumission: '2026-06-15T09:00:00' });
    });

    it('rejectOrder et rejectOrderResult transmettent le motif', () => {
      api.rejectOrder('o1', 'KO').subscribe();
      const req1 = expectReq('POST', '/orders/o1/reject');
      expect(req1.request.body).toEqual({ motif: 'KO' });
      req1.flush({ id: 'o1', dateSoumission: '2026-06-15T09:00:00' });
      api.rejectOrderResult('o1', 'KO2').subscribe();
      const req2 = expectReq('POST', '/orders/o1/reject-result');
      expect(req2.request.body).toEqual({ motif: 'KO2' });
      req2.flush({ id: 'o1', dateSoumission: '2026-06-15T09:00:00' });
    });

    it('changeOrderStatus transmet le corps complet', () => {
      const body = { status: 'TOTALEMENT_RETENU', montantAdjuge: 1000, tauxAdjuge: 5 };
      api.changeOrderStatus('o1', body).subscribe();
      const req = expectReq('POST', '/orders/o1/status');
      expect(req.request.body).toEqual(body);
      req.flush({ id: 'o1', dateSoumission: '2026-06-15T09:00:00' });
    });

    it('listOrdersPendingValidation passe les paramètres pendingValidation et size', () => {
      const res = vi.fn();
      api.listOrdersPendingValidation().subscribe(res);
      const req = httpMock.expectOne(
        (r) => r.url === `${API}/orders`
          && r.params.get('pendingValidation') === 'true'
          && r.params.get('size') === '200',
      );
      req.flush({ data: [{ id: 'o1', dateSoumission: '2026-06-15T09:00:00' }] });
      expect(res.mock.calls[0][0][0]).toMatchObject({ dateSoumission: '2026-06-15 09:00' });
    });

    it('listOrdersPendingValidation tolère une réponse sans data', () => {
      const res = vi.fn();
      api.listOrdersPendingValidation().subscribe(res);
      httpMock.expectOne((r) => r.url === `${API}/orders`).flush({});
      expect(res).toHaveBeenCalledWith([]);
    });

    it('setOrderNotes poste la note interne', () => {
      api.setOrderNotes('o1', 'note').subscribe();
      const req = expectReq('POST', '/orders/o1/notes');
      expect(req.request.body).toEqual({ notes: 'note' });
      req.flush({ id: 'o1', dateSoumission: '2026-06-15T09:00:00' });
    });

    it('verifyOrderSignature transmet le verdict', () => {
      api.verifyOrderSignature('o1', true).subscribe();
      const req = expectReq('POST', '/orders/o1/verify-signature');
      expect(req.request.body).toEqual({ verified: true });
      req.flush({ id: 'o1', dateSoumission: '2026-06-15T09:00:00' });
    });
  });

  // ──────────────────────────────────── Audit ────────────────────────────────

  it('listAudit convertit l’horodatage de chaque entrée', () => {
    const res = vi.fn();
    api.listAudit().subscribe(res);
    expectReq('GET', '/audit?size=100').flush(page([{ id: 'a1', horodatage: '2026-06-15T09:00:00' }]));
    expect(res.mock.calls[0][0][0]).toMatchObject({ horodatage: '2026-06-15 09:00' });
  });

  // ──────────────────────────── Comptes utilisateurs ─────────────────────────

  describe('utilisateurs', () => {
    it('listUsers renvoie la page des acteurs internes', () => {
      const res = vi.fn();
      api.listUsers().subscribe(res);
      expectReq('GET', '/users?size=100').flush(page([{ id: 'u1' }]));
      expect(res.mock.calls[0][0]).toHaveLength(1);
    });

    it('createUser poste le compte', () => {
      const body = { email: 'a@b.cm', password: 'x', role: 'AGENT', nom: 'Doe' } as any;
      api.createUser(body).subscribe();
      const req = expectReq('POST', '/users');
      expect(req.request.body).toEqual(body);
      req.flush({ id: 'u1' });
    });

    it('updateUser émet un PATCH', () => {
      api.updateUser('u1', { nom: 'Doe2' }).subscribe();
      const req = expectReq('PATCH', '/users/u1');
      expect(req.request.body).toEqual({ nom: 'Doe2' });
      req.flush({ id: 'u1' });
    });

    it('resetUserPassword transmet un mot de passe explicite (trimé)', () => {
      api.resetUserPassword('u1', '  secret  ').subscribe();
      const req = expectReq('POST', '/users/u1/reset-password');
      expect(req.request.body).toEqual({ password: 'secret' });
      req.flush({ temporaryPassword: 'x' });
    });

    it('resetUserPassword envoie un corps vide sans mot de passe (généré côté serveur)', () => {
      api.resetUserPassword('u1').subscribe();
      const sansMdp = expectReq('POST', '/users/u1/reset-password');
      expect(sansMdp.request.body).toEqual({});
      sansMdp.flush({ temporaryPassword: 'gen' });

      api.resetUserPassword('u1', '   ').subscribe();
      const mdpBlanc = expectReq('POST', '/users/u1/reset-password');
      expect(mdpBlanc.request.body).toEqual({});
      mdpBlanc.flush({ temporaryPassword: 'gen' });
    });

    it('deleteUser émet un DELETE', () => {
      const res = vi.fn();
      api.deleteUser('u1').subscribe(res);
      expectReq('DELETE', '/users/u1').flush({ deleted: true });
      expect(res).toHaveBeenCalledWith({ deleted: true });
    });

    it('getInitialPassword récupère le mot de passe initial', () => {
      const res = vi.fn();
      api.getInitialPassword('u1').subscribe(res);
      expectReq('GET', '/users/u1/initial-password').flush({ password: 'p', available: true });
      expect(res).toHaveBeenCalledWith({ password: 'p', available: true });
    });
  });

  // ─────────────────────────────────── Livrables ─────────────────────────────

  describe('livrables', () => {
    it('listDocuments convertit dateGeneration', () => {
      const res = vi.fn();
      api.listDocuments().subscribe(res);
      expectReq('GET', '/documents?size=100').flush(page([{ id: 'd1', dateGeneration: '2026-07-01T08:00:00' }]));
      expect(res.mock.calls[0][0][0]).toMatchObject({ dateGeneration: '2026-07-01 08:00' });
    });

    it('uploadDocument poste le livrable', () => {
      const body = { clientId: 'c1', type: 'AVIS', titre: 'T', mimeType: 'text/plain', contenu: 'x' };
      api.uploadDocument(body).subscribe();
      const req = expectReq('POST', '/documents');
      expect(req.request.body).toEqual(body);
      req.flush({ id: 'd1' });
    });

    it('getDocument récupère le détail', () => {
      const res = vi.fn();
      api.getDocument('d1').subscribe(res);
      expectReq('GET', '/documents/d1').flush({ id: 'd1', contenu: 'data:...' });
      expect(res.mock.calls[0][0]).toMatchObject({ id: 'd1' });
    });
  });

  // ─────────────────────────────── Notifications ─────────────────────────────

  describe('notifications', () => {
    it('listNotifications mappe le modèle backend vers le modèle applicatif', () => {
      const res = vi.fn();
      api.listNotifications().subscribe(res);
      expectReq('GET', '/notifications?size=100').flush(page([
        { id: 'n1', type: 'SUCCESS', titre: 'T', message: 'M', lu: false, createdAt: '2026-07-01T08:00:00' },
      ]));
      expect(res.mock.calls[0][0][0]).toEqual({
        id: 'n1', type: 'SUCCESS', titre: 'T', message: 'M',
        date: '2026-07-01 08:00', lu: false, canal: ['IN_APP'],
      });
    });

    it('markNotificationRead et markAllNotificationsRead postent un corps vide', () => {
      api.markNotificationRead('n1').subscribe();
      const une = expectReq('POST', '/notifications/n1/read');
      expect(une.request.body).toEqual({});
      une.flush(null);

      api.markAllNotificationsRead().subscribe();
      const toutes = expectReq('POST', '/notifications/read-all');
      expect(toutes.request.body).toEqual({});
      toutes.flush(null);
    });
  });


  // ─────────────────────────── QR / Configuration ────────────────────────────

  it('getConnectionQr récupère le lien et le QR', () => {
    const res = vi.fn();
    api.getConnectionQr().subscribe(res);
    expectReq('GET', '/connection-qr').flush({ url: 'https://x', qrCodeDataUrl: 'data:png' });
    expect(res).toHaveBeenCalledWith({ url: 'https://x', qrCodeDataUrl: 'data:png' });
  });

  it('getMarcheConfig et updateMarcheConfig manipulent la config marché', () => {
    const cfg = { statuses: ['PUBLIE'], dateDu: '', dateAu: '' };
    api.getMarcheConfig().subscribe();
    expectReq('GET', '/admin/marche-config').flush(cfg);
    api.updateMarcheConfig(cfg).subscribe();
    const req = expectReq('PUT', '/admin/marche-config');
    expect(req.request.body).toEqual(cfg);
    req.flush(cfg);
  });

  // ────────────────────────────── Administration ─────────────────────────────

  describe('administration', () => {
    it('mail-settings : get / update / test', () => {
      api.getMailSettings().subscribe();
      expectReq('GET', '/admin/mail-settings').flush({});
      api.updateMailSettings({ host: 'smtp' } as any).subscribe();
      const maj = expectReq('PUT', '/admin/mail-settings');
      expect(maj.request.body).toEqual({ host: 'smtp' });
      maj.flush({});

      api.testMailSettings('a@b.cm').subscribe();
      const essai = expectReq('POST', '/admin/mail-settings/test');
      expect(essai.request.body).toEqual({ to: 'a@b.cm' });
      essai.flush({ status: 'SENT' });
    });

    it('ldap-settings : get / update / test', () => {
      api.getLdapSettings().subscribe();
      expectReq('GET', '/admin/ldap-settings').flush({});
      api.updateLdapSettings({ host: 'ldap' } as any).subscribe();
      const maj = expectReq('PUT', '/admin/ldap-settings');
      expect(maj.request.body).toEqual({ host: 'ldap' });
      maj.flush({});

      const res = vi.fn();
      api.testLdapSettings().subscribe(res);
      const essai = expectReq('POST', '/admin/ldap-settings/test');
      expect(essai.request.body).toEqual({});
      essai.flush({ ok: true, message: 'OK' });
      expect(res).toHaveBeenCalledWith({ ok: true, message: 'OK' });
    });

    it('otp-settings : get / update', () => {
      api.getOtpSettings().subscribe();
      expectReq('GET', '/admin/otp-settings').flush({});
      api.updateOtpSettings({ canal: 'EMAIL' } as any).subscribe();
      const maj = expectReq('PUT', '/admin/otp-settings');
      expect(maj.request.body).toEqual({ canal: 'EMAIL' });
      maj.flush({});
    });

    it('getOtpLog n’envoie que size par défaut', () => {
      api.getOtpLog().subscribe();
      const req = httpMock.expectOne(
        (r) => r.url === `${API}/admin/otp-log`
          && r.params.get('size') === '100'
          && r.params.get('q') === null
          && r.params.get('activeOnly') === null,
      );
      req.flush(page([]));
    });

    it('getOtpLog ajoute q (trimé) et activeOnly quand fournis', () => {
      api.getOtpLog('  jean  ', true).subscribe();
      const req = httpMock.expectOne(
        (r) => r.url === `${API}/admin/otp-log`
          && r.params.get('q') === 'jean'
          && r.params.get('activeOnly') === 'true'
          && r.params.get('size') === '100',
      );
      req.flush(page([]));
    });
  });
});
