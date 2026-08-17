import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { authInterceptor } from './auth-interceptor';
import { AuthService } from '../services/auth-service';
import { environment } from '../../../environments/environment';

const API = environment.apiBaseUrl; // '/api/v1'

function setup(auth: Partial<AuthService>) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: auth },
    ],
  });
  return {
    http: TestBed.inject(HttpClient),
    httpMock: TestBed.inject(HttpTestingController),
  };
}

describe('authInterceptor', () => {
  let httpMock: HttpTestingController;

  afterEach(() => httpMock?.verify());

  // ─── Attachement du jeton ──────────────────────────────────────────────────

  it('ajoute l’en-tête Authorization aux appels API authentifiés', () => {
    const ctx = setup({ getAccessToken: () => 'tok-123', hasRefreshToken: () => true });
    httpMock = ctx.httpMock;

    ctx.http.get(`${API}/emissions`).subscribe();
    const req = httpMock.expectOne(`${API}/emissions`);
    expect(req.request.headers.get('Authorization')).toBe('Bearer tok-123');
    req.flush({});
  });

  it('n’ajoute pas de jeton quand il n’y en a pas', () => {
    const ctx = setup({ getAccessToken: () => null, hasRefreshToken: () => false });
    httpMock = ctx.httpMock;

    ctx.http.get(`${API}/emissions`).subscribe();
    const req = httpMock.expectOne(`${API}/emissions`);
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('n’attache jamais le jeton à un domaine tiers (anti-fuite)', () => {
    const ctx = setup({ getAccessToken: () => 'tok-123', hasRefreshToken: () => true });
    httpMock = ctx.httpMock;

    ctx.http.get('https://tiers.example/collect').subscribe();
    const req = httpMock.expectOne('https://tiers.example/collect');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it.each(['/auth/login', '/auth/mfa/verify', '/auth/refresh'])(
    'n’attache pas le jeton à l’endpoint d’authentification %s',
    (path) => {
      const ctx = setup({ getAccessToken: () => 'tok-123', hasRefreshToken: () => true });
      httpMock = ctx.httpMock;

      ctx.http.post(`${API}${path}`, {}).subscribe();
      const req = httpMock.expectOne(`${API}${path}`);
      expect(req.request.headers.has('Authorization')).toBe(false);
      req.flush({});
    },
  );

  // ─── Rejeu après 401 ──────────────────────────────────────────────────────

  it('sur 401, rafraîchit le jeton et rejoue la requête avec le nouveau jeton', () => {
    const refresh = vi.fn(() => of('tok-neuf'));
    const ctx = setup({
      getAccessToken: () => 'tok-perime',
      hasRefreshToken: () => true,
      refresh: refresh as any,
    });
    httpMock = ctx.httpMock;

    const observed = vi.fn();
    ctx.http.get(`${API}/emissions`).subscribe(observed);

    const first = httpMock.expectOne(`${API}/emissions`);
    expect(first.request.headers.get('Authorization')).toBe('Bearer tok-perime');
    first.flush({ msg: 'expired' }, { status: 401, statusText: 'Unauthorized' });

    expect(refresh).toHaveBeenCalledTimes(1);

    const replay = httpMock.expectOne(`${API}/emissions`);
    expect(replay.request.headers.get('Authorization')).toBe('Bearer tok-neuf');
    replay.flush({ ok: true });

    expect(observed).toHaveBeenCalledWith({ ok: true });
  });

  it('propage l’erreur quand le rafraîchissement échoue', () => {
    const ctx = setup({
      getAccessToken: () => 'tok-perime',
      hasRefreshToken: () => true,
      refresh: (() => throwError(() => new Error('refresh failed'))) as any,
    });
    httpMock = ctx.httpMock;

    const onError = vi.fn();
    ctx.http.get(`${API}/emissions`).subscribe({ error: onError });

    httpMock.expectOne(`${API}/emissions`)
      .flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(onError).toHaveBeenCalledOnce();
  });

  it('ne tente aucun rafraîchissement sans jeton de rafraîchissement', () => {
    const refresh = vi.fn(() => of('tok-neuf'));
    const ctx = setup({
      getAccessToken: () => 'tok-perime',
      hasRefreshToken: () => false,
      refresh: refresh as any,
    });
    httpMock = ctx.httpMock;

    const onError = vi.fn();
    ctx.http.get(`${API}/emissions`).subscribe({ error: onError });

    httpMock.expectOne(`${API}/emissions`)
      .flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(refresh).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('ne rejoue pas un 401 provenant de /auth/login', () => {
    const refresh = vi.fn(() => of('tok-neuf'));
    const ctx = setup({
      getAccessToken: () => null,
      hasRefreshToken: () => true,
      refresh: refresh as any,
    });
    httpMock = ctx.httpMock;

    const onError = vi.fn();
    ctx.http.post(`${API}/auth/login`, {}).subscribe({ error: onError });

    httpMock.expectOne(`${API}/auth/login`)
      .flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(refresh).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('ne rejoue pas une erreur non-401 (ex. 500)', () => {
    const refresh = vi.fn(() => of('tok-neuf'));
    const ctx = setup({
      getAccessToken: () => 'tok-123',
      hasRefreshToken: () => true,
      refresh: refresh as any,
    });
    httpMock = ctx.httpMock;

    const onError = vi.fn();
    ctx.http.get(`${API}/emissions`).subscribe({ error: onError });

    httpMock.expectOne(`${API}/emissions`)
      .flush({}, { status: 500, statusText: 'Server Error' });

    expect(refresh).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('ne rejoue pas un 401 venant d’un domaine tiers', () => {
    const refresh = vi.fn(() => of('tok-neuf'));
    const ctx = setup({
      getAccessToken: () => 'tok-123',
      hasRefreshToken: () => true,
      refresh: refresh as any,
    });
    httpMock = ctx.httpMock;

    const onError = vi.fn();
    ctx.http.get('https://tiers.example/x').subscribe({ error: onError });

    httpMock.expectOne('https://tiers.example/x')
      .flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(refresh).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });
});
