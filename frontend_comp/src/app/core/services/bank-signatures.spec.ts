import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { BankSignaturesService } from './bank-signatures';
import { SIGNATURES_DIRIGEANTS } from './api-endpoints';

const SIGS = [
  { nom: 'FOTSO Marie', fonction: 'Directeur Général', signatureData: 'data:image/png;base64,AAA' },
];

describe('BankSignaturesService', () => {
  let svc: BankSignaturesService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), BankSignaturesService],
    });
    svc = TestBed.inject(BankSignaturesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('charge les signatures actives', () => {
    const got = vi.fn();
    svc.get().subscribe(got);
    httpMock.expectOne(SIGNATURES_DIRIGEANTS.ACTIVES).flush(SIGS);
    expect(got).toHaveBeenCalledWith(SIGS);
  });

  it('met le résultat en cache (un seul appel réseau)', () => {
    svc.get().subscribe();
    svc.get().subscribe();
    httpMock.expectOne(SIGNATURES_DIRIGEANTS.ACTIVES).flush(SIGS);
    // expectOne échouerait si un second appel avait été émis.
  });

  it('une panne ne bloque pas la génération : renvoie une liste vide', () => {
    const got = vi.fn();
    const onError = vi.fn();
    svc.get().subscribe({ next: got, error: onError });
    httpMock.expectOne(SIGNATURES_DIRIGEANTS.ACTIVES)
      .flush({}, { status: 500, statusText: 'Server Error' });

    expect(onError).not.toHaveBeenCalled();
    expect(got).toHaveBeenCalledWith([]);
  });

  it('invalider() force un rechargement', () => {
    svc.get().subscribe();
    httpMock.expectOne(SIGNATURES_DIRIGEANTS.ACTIVES).flush(SIGS);

    svc.invalider();
    svc.get().subscribe();
    httpMock.expectOne(SIGNATURES_DIRIGEANTS.ACTIVES).flush(SIGS);
  });
});
