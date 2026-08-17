import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { AuthService } from './auth-service';
import { MockData } from './mock-data';
import { UserRole } from '../models/models';
import { environment } from '../../../environments/environment';

const API = environment.apiBaseUrl;

/** Double de MockData : signaux d'état + méthodes d'hydratation espionnées. */
function makeMock(permissions: string[] = []) {
  return {
    currentUser: signal<any>({ id: '', role: 'CLIENT_PP' as UserRole }),
    isAuthenticated: signal(false),
    hasPermission: vi.fn((p: string) => permissions.includes(p)),
    refreshEmissions: vi.fn(),
    refreshMarcheConfig: vi.fn(),
    refreshOrders: vi.fn(),
    refreshNotifications: vi.fn(),
    refreshDocuments: vi.fn(),
    refreshPermissions: vi.fn(),
    refreshAudit: vi.fn(),
    refreshClients: vi.fn(),
    refreshPositions: vi.fn(),
    refreshMyCompte: vi.fn(),
  };
}

function backendUser(over: Partial<any> = {}) {
  return {
    id: 'u-1', nom: 'Doe', prenom: 'John', email: 'j@d.cm',
    role: 'CLIENT_PP' as UserRole, statut: 'ACTIF', ...over,
  };
}

function authResponse(over: Partial<any> = {}) {
  return {
    accessToken: 'acc-1', refreshToken: 'ref-1', tokenType: 'Bearer',
    expiresIn: 900, user: backendUser(), ...over,
  };
}

describe('AuthService', () => {
  let svc: AuthService;
  let httpMock: HttpTestingController;
  let mock: ReturnType<typeof makeMock>;

  /** (Re)construit un TestBed isolé — appelable depuis un test pour changer les permissions. */
  function setup(permissions: string[] = []) {
    TestBed.resetTestingModule();
    mock = makeMock(permissions);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MockData, useValue: mock },
      ],
    });
    svc = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  }

  beforeEach(() => setup());
  afterEach(() => httpMock.verify());

  // ─── Helpers purs ─────────────────────────────────────────────────────────

  describe('redirectFor', () => {
    it.each<UserRole>(['CLIENT_PP', 'CLIENT_PM'])('renvoie l’espace client pour %s', (r) => {
      expect(svc.redirectFor(r)).toBe('/client/dashboard');
    });

    it.each<UserRole>(['AGENT', 'SUPERVISEUR', 'ADMIN'])('renvoie le back-office pour %s', (r) => {
      expect(svc.redirectFor(r)).toBe('/backoffice/dashboard');
    });
  });

  describe('errorMessage', () => {
    const cases: Array<[number, string]> = [
      [0, 'Service indisponible. Vérifiez votre connexion réseau.'],
      [400, 'Informations invalides. Vérifiez votre saisie.'],
      [422, 'Informations invalides. Vérifiez votre saisie.'],
      [401, 'Identifiants incorrects.'],
      [403, "Vous n'êtes pas autorisé à effectuer cette action."],
      [404, 'Élément introuvable.'],
      [429, 'Trop de tentatives. Réessayez dans quelques minutes.'],
      [500, 'Le service rencontre un problème. Réessayez plus tard.'],
      [503, 'Le service rencontre un problème. Réessayez plus tard.'],
    ];

    it.each(cases)('traduit un HTTP %i', (status, expected) => {
      expect(svc.errorMessage(new HttpErrorResponse({ status }))).toBe(expected);
    });

    it('message générique pour une erreur non HTTP', () => {
      expect(svc.errorMessage(new Error('boom'))).toBe('Une erreur est survenue. Réessayez.');
      expect(svc.errorMessage(undefined)).toBe('Une erreur est survenue. Réessayez.');
    });

    it('ne divulgue jamais le détail technique de l’erreur', () => {
      const err = new HttpErrorResponse({ status: 500, statusText: 'NullPointerException at db.rs:42' });
      expect(svc.errorMessage(err)).not.toContain('NullPointer');
    });
  });

  // ─── État de session ──────────────────────────────────────────────────────

  it('aucune session au démarrage', () => {
    expect(svc.getAccessToken()).toBeNull();
    expect(svc.hasRefreshToken()).toBe(false);
    expect(svc.pendingChallenge()).toBeNull();
  });

  // ─── login ────────────────────────────────────────────────────────────────

  describe('login', () => {
    it('poste les identifiants et ouvre un défi MFA', () => {
      svc.login('  j@d.cm  ', 'secret', '/client/ordres').subscribe();

      const req = httpMock.expectOne(`${API}/auth/login`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ email: 'j@d.cm', password: 'secret' });
      req.flush({ mfaRequired: true, challengeId: 'ch-1', expiresIn: 300, phoneHint: '+237****89' });

      expect(svc.pendingChallenge()).toEqual({
        challengeId: 'ch-1', returnUrl: '/client/ordres', phoneHint: '+237****89',
      });
    });

    it('utilise « / » comme returnUrl par défaut', () => {
      svc.login('a@b.cm', 'x').subscribe();
      httpMock.expectOne(`${API}/auth/login`).flush({ mfaRequired: true, challengeId: 'ch-1', expiresIn: 300 });
      expect(svc.pendingChallenge()?.returnUrl).toBe('/');
    });
  });

  // ─── verifyMfa ────────────────────────────────────────────────────────────

  describe('verifyMfa', () => {
    function openChallenge(returnUrl = '/') {
      svc.login('a@b.cm', 'x', returnUrl).subscribe();
      httpMock.expectOne(`${API}/auth/login`).flush({ mfaRequired: true, challengeId: 'ch-1', expiresIn: 300 });
    }

    it('échoue sans défi en attente', () => {
      const onError = vi.fn();
      svc.verifyMfa('123456').subscribe({ error: onError });
      expect(onError).toHaveBeenCalledOnce();
    });

    it('établit la session et redirige selon le rôle', () => {
      openChallenge();
      const dest = vi.fn();
      svc.verifyMfa('123456').subscribe(dest);

      const req = httpMock.expectOne(`${API}/auth/mfa/verify`);
      expect(req.request.body).toEqual({ challengeId: 'ch-1', code: '123456' });
      req.flush(authResponse());

      expect(dest).toHaveBeenCalledWith('/client/dashboard');
      expect(svc.getAccessToken()).toBe('acc-1');
      expect(svc.hasRefreshToken()).toBe(true);
      expect(mock.isAuthenticated()).toBe(true);
      expect(svc.pendingChallenge()).toBeNull();
    });

    it('honore le returnUrl demandé quand il n’est pas « / »', () => {
      openChallenge('/client/ordres');
      const dest = vi.fn();
      svc.verifyMfa('123456').subscribe(dest);
      httpMock.expectOne(`${API}/auth/mfa/verify`).flush(authResponse());
      expect(dest).toHaveBeenCalledWith('/client/ordres');
    });

    it('force le changement de mot de passe à la première connexion', () => {
      openChallenge('/client/ordres');
      const dest = vi.fn();
      svc.verifyMfa('123456').subscribe(dest);
      httpMock.expectOne(`${API}/auth/mfa/verify`)
        .flush(authResponse({ user: backendUser({ mustChangePassword: true }) }));
      expect(dest).toHaveBeenCalledWith('/auth/change-password');
    });

    it('hydrate les données client pour un CLIENT_PP', () => {
      openChallenge();
      svc.verifyMfa('123456').subscribe();
      httpMock.expectOne(`${API}/auth/mfa/verify`).flush(authResponse());

      expect(mock.refreshEmissions).toHaveBeenCalled();
      expect(mock.refreshPositions).toHaveBeenCalled();
      expect(mock.refreshMyCompte).toHaveBeenCalled();
    });

    it('n’hydrate pas le portefeuille pour un rôle back-office', () => {
      setup();
      svc.login('a@b.cm', 'x').subscribe();
      httpMock.expectOne(`${API}/auth/login`).flush({ mfaRequired: true, challengeId: 'ch-1', expiresIn: 300 });
      svc.verifyMfa('123456').subscribe();
      httpMock.expectOne(`${API}/auth/mfa/verify`)
        .flush(authResponse({ user: backendUser({ role: 'AGENT' }) }));

      expect(mock.refreshPositions).not.toHaveBeenCalled();
      expect(mock.refreshMyCompte).not.toHaveBeenCalled();
    });

    it('charge l’audit uniquement avec la permission AUDIT_READ', () => {
      setup(['AUDIT_READ']);
      svc.login('a@b.cm', 'x').subscribe();
      httpMock.expectOne(`${API}/auth/login`).flush({ mfaRequired: true, challengeId: 'ch-1', expiresIn: 300 });
      svc.verifyMfa('123456').subscribe();
      httpMock.expectOne(`${API}/auth/mfa/verify`)
        .flush(authResponse({ user: backendUser({ role: 'ADMIN' }) }));

      expect(mock.refreshAudit).toHaveBeenCalled();
      expect(mock.refreshClients).not.toHaveBeenCalled();
    });
  });

  it('cancelPending() efface le défi en cours', () => {
    svc.login('a@b.cm', 'x').subscribe();
    httpMock.expectOne(`${API}/auth/login`).flush({ mfaRequired: true, challengeId: 'ch-1', expiresIn: 300 });
    svc.cancelPending();
    expect(svc.pendingChallenge()).toBeNull();
  });

  // ─── refresh ──────────────────────────────────────────────────────────────

  describe('refresh', () => {
    it('échange le cookie contre un nouveau jeton d’accès', () => {
      const got = vi.fn();
      svc.refresh().subscribe(got);
      httpMock.expectOne(`${API}/auth/refresh`).flush(authResponse({ accessToken: 'acc-2' }));
      expect(got).toHaveBeenCalledWith('acc-2');
      expect(svc.getAccessToken()).toBe('acc-2');
    });

    it('partage un rafraîchissement concurrent (un seul appel réseau)', () => {
      const a = vi.fn();
      const b = vi.fn();
      svc.refresh().subscribe(a);
      svc.refresh().subscribe(b);

      httpMock.expectOne(`${API}/auth/refresh`).flush(authResponse({ accessToken: 'acc-2' }));

      expect(a).toHaveBeenCalledWith('acc-2');
      expect(b).toHaveBeenCalledWith('acc-2');
    });

    it('autorise un nouvel appel après la fin du précédent', () => {
      svc.refresh().subscribe();
      httpMock.expectOne(`${API}/auth/refresh`).flush(authResponse());
      svc.refresh().subscribe();
      httpMock.expectOne(`${API}/auth/refresh`).flush(authResponse());
    });
  });

  describe('restoreSession', () => {
    it('renvoie true quand le refresh aboutit', () => {
      const got = vi.fn();
      svc.restoreSession().subscribe(got);
      httpMock.expectOne(`${API}/auth/refresh`).flush(authResponse());
      expect(got).toHaveBeenCalledWith(true);
      expect(mock.isAuthenticated()).toBe(true);
    });

    it('renvoie false et purge la session quand le refresh échoue', () => {
      const got = vi.fn();
      svc.restoreSession().subscribe(got);
      httpMock.expectOne(`${API}/auth/refresh`).flush({}, { status: 401, statusText: 'Unauthorized' });
      expect(got).toHaveBeenCalledWith(false);
      expect(svc.getAccessToken()).toBeNull();
      expect(mock.isAuthenticated()).toBe(false);
    });
  });

  // ─── logout ───────────────────────────────────────────────────────────────

  describe('logout', () => {
    function authenticate() {
      svc.refresh().subscribe();
      httpMock.expectOne(`${API}/auth/refresh`).flush(authResponse());
    }

    it('purge localement sans appel réseau quand aucun jeton n’est présent', () => {
      const done = vi.fn();
      svc.logout().subscribe(done);
      expect(done).toHaveBeenCalledOnce();
      httpMock.expectNone(`${API}/auth/logout`);
    });

    it('révoque côté serveur puis purge l’état local', () => {
      authenticate();
      const done = vi.fn();
      svc.logout().subscribe(done);
      httpMock.expectOne(`${API}/auth/logout`).flush({});

      expect(done).toHaveBeenCalledOnce();
      expect(svc.getAccessToken()).toBeNull();
      expect(svc.hasRefreshToken()).toBe(false);
      expect(mock.isAuthenticated()).toBe(false);
    });

    it('aboutit même si l’appel serveur échoue', () => {
      authenticate();
      const done = vi.fn();
      svc.logout().subscribe(done);
      httpMock.expectOne(`${API}/auth/logout`).flush({}, { status: 500, statusText: 'Server Error' });

      expect(done).toHaveBeenCalledOnce();
      expect(svc.getAccessToken()).toBeNull();
      expect(mock.isAuthenticated()).toBe(false);
    });
  });

  // ─── Mot de passe / OTP d'action ──────────────────────────────────────────

  describe('changePassword', () => {
    it('omet currentPassword à la première connexion', () => {
      svc.changePassword(undefined, 'NouveauMdp1!').subscribe();
      const req = httpMock.expectOne(`${API}/auth/change-password`);
      expect(req.request.body).toEqual({ newPassword: 'NouveauMdp1!' });
      req.flush({});
    });

    it('transmet currentPassword lors d’un changement volontaire', () => {
      svc.changePassword('Ancien1!', 'Nouveau1!').subscribe();
      const req = httpMock.expectOne(`${API}/auth/change-password`);
      expect(req.request.body).toEqual({ currentPassword: 'Ancien1!', newPassword: 'Nouveau1!' });
      req.flush({});
    });

    it('purge la session pour forcer une reconnexion', () => {
      svc.refresh().subscribe();
      httpMock.expectOne(`${API}/auth/refresh`).flush(authResponse());

      svc.changePassword(undefined, 'Nouveau1!').subscribe();
      httpMock.expectOne(`${API}/auth/change-password`).flush({});

      expect(svc.getAccessToken()).toBeNull();
      expect(mock.isAuthenticated()).toBe(false);
    });
  });

  it('forgotPassword() normalise l’e-mail', () => {
    svc.forgotPassword('  a@b.cm ').subscribe();
    const req = httpMock.expectOne(`${API}/auth/forgot-password`);
    expect(req.request.body).toEqual({ email: 'a@b.cm' });
    req.flush({});
  });

  it('resetPassword() poste le jeton et le nouveau mot de passe', () => {
    svc.resetPassword('tok-reset', 'Nouveau1!').subscribe();
    const req = httpMock.expectOne(`${API}/auth/reset-password`);
    expect(req.request.body).toEqual({ token: 'tok-reset', newPassword: 'Nouveau1!' });
    req.flush({});
  });

  it('sendActionOtp() renvoie le défi émis', () => {
    const got = vi.fn();
    svc.sendActionOtp().subscribe(got);
    httpMock.expectOne(`${API}/auth/otp/send`).flush({ challengeId: 'ch-9', expiresIn: 120 });
    expect(got).toHaveBeenCalledWith({ challengeId: 'ch-9', expiresIn: 120 });
  });

  it('verifyActionOtp() poste le défi et le code', () => {
    svc.verifyActionOtp('ch-9', '000111').subscribe();
    const req = httpMock.expectOne(`${API}/auth/otp/verify`);
    expect(req.request.body).toEqual({ challengeId: 'ch-9', code: '000111' });
    req.flush({});
  });
});
