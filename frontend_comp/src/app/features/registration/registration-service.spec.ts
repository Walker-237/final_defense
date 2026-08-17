import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { RegistrationService } from './registration-service';
import { REGISTRATION } from '../../core/services/api-endpoints';

describe('RegistrationService', () => {
  let svc: RegistrationService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), RegistrationService],
    });
    svc = TestBed.inject(RegistrationService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('register() poste le corps d’inscription', () => {
    const body = { email: 'a@b.cm', password: 'MotDePasse1', nom: 'NGONO',
                   typePersonne: 'PP' as const, compteEspeces: '1000500010000004320768' };
    const got = vi.fn();
    svc.register(body).subscribe(got);

    const req = httpMock.expectOne(REGISTRATION.REGISTER);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(body);
    req.flush({ dossierId: 'd1', titulaireId: 't1', auth: { accessToken: 'tok' } });
    expect(got).toHaveBeenCalledWith(expect.objectContaining({ dossierId: 'd1' }));
  });

  it('uploadFace() attache le jeton mémorisé et poste sur le bon dossier', () => {
    svc.setToken('tok-123');
    const face = { imageBase64: 'data:image/jpeg;base64,AAA', landmarksJson: '[]',
                   livenessScore: 0.9, livenessPassed: true, challengeType: 'BLINK' as const,
                   width: 640, height: 480, descriptor: null };
    svc.uploadFace('d1', face).subscribe();

    const req = httpMock.expectOne(REGISTRATION.FACE('d1'));
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Authorization')).toBe('Bearer tok-123');
    expect(req.request.body).toEqual(face);
    req.flush({ faceId: 'f1' });
  });

  it('uploadFace() sans jeton n’envoie pas d’en-tête Authorization', () => {
    svc.uploadFace('d1', { imageBase64: 'x', landmarksJson: '[]', livenessScore: 1,
      livenessPassed: true, challengeType: 'BLINK', width: 1, height: 1,
      descriptor: null }).subscribe();
    const req = httpMock.expectOne(REGISTRATION.FACE('d1'));
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({ faceId: 'f1' });
  });

  it('getDossier() lit l’état du dossier avec le jeton', () => {
    svc.setToken('tok');
    svc.getDossier('d9').subscribe();
    const req = httpMock.expectOne(REGISTRATION.DOSSIER('d9'));
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.get('Authorization')).toBe('Bearer tok');
    req.flush({ statut: 'BROUILLON' });
  });

  it('getConvention() interroge la langue demandée (publique)', () => {
    const got = vi.fn();
    svc.getConvention('FR').subscribe(got);
    const req = httpMock.expectOne(`${REGISTRATION.CONVENTION}?langue=FR`);
    expect(req.request.method).toBe('GET');
    req.flush({ version: '2026-01', titre: 'C', contenuHtml: '<h1>x</h1>', langue: 'FR' });
    expect(got).toHaveBeenCalledWith(expect.objectContaining({ version: '2026-01' }));
  });

  it('getConvention() utilise FR par défaut', () => {
    svc.getConvention().subscribe();
    httpMock.expectOne(`${REGISTRATION.CONVENTION}?langue=FR`).flush({});
  });
});
