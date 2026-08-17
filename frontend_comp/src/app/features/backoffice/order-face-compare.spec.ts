import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { OrderFaceCompare } from './order-face-compare';
import { ORDER_FACE_CHECK } from '../../core/services/api-endpoints';

const CHECK = {
  orderId: 'o1',
  photoOuverture: 'data:image/jpeg;base64,AAA',
  photoOrdre: 'data:image/jpeg;base64,BBB',
  distance: 0.31,
  seuil: 0.6,
  matchStatus: 'CORRESPOND' as const,
  livenessScore: 0.9,
  verificationStatus: 'EN_ATTENTE' as const,
};

describe('OrderFaceCompare', () => {
  let httpMock: HttpTestingController;

  function make() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const f = TestBed.createComponent(OrderFaceCompare);
    httpMock = TestBed.inject(HttpTestingController);
    return f;
  }

  afterEach(() => httpMock.verify());

  it('charge les deux photos de l’ordre', () => {
    const f = make();
    f.componentInstance.orderId = 'o1';
    httpMock.expectOne(ORDER_FACE_CHECK.ADMIN_GET('o1')).flush(CHECK);

    const c = f.componentInstance.check();
    expect(c?.photoOuverture).toContain('AAA');
    expect(c?.photoOrdre).toContain('BBB');
    expect(f.componentInstance.absent()).toBe(false);
  });

  it('signale l’absence de contrôle facial (client a passé l’étape)', () => {
    const f = make();
    f.componentInstance.orderId = 'o1';
    httpMock.expectOne(ORDER_FACE_CHECK.ADMIN_GET('o1'))
      .flush({}, { status: 404, statusText: 'Not Found' });

    expect(f.componentInstance.absent()).toBe(true);
    expect(f.componentInstance.check()).toBeNull();
  });

  it('libelle les verdicts automatiques', () => {
    const f = make();
    const c = f.componentInstance;
    expect(c.verdict('CORRESPOND')).toContain('correspondant');
    expect(c.verdict('DIFFERENT')).toContain('différent');
    expect(c.verdict('NON_COMPARABLE')).toContain('Non comparable');
  });

  it('la revue humaine valide l’identité', () => {
    const f = make();
    f.componentInstance.orderId = 'o1';
    httpMock.expectOne(ORDER_FACE_CHECK.ADMIN_GET('o1')).flush(CHECK);

    f.componentInstance.verifier('VALIDE');
    const req = httpMock.expectOne(ORDER_FACE_CHECK.ADMIN_VERIFY('o1'));
    expect(req.request.body).toEqual({ status: 'VALIDE' });
    req.flush({ verificationStatus: 'VALIDE' });

    expect(f.componentInstance.check()?.verificationStatus).toBe('VALIDE');
    expect(f.componentInstance.busy()).toBe(false);
  });

  it('la revue humaine peut rejeter l’identité', () => {
    const f = make();
    f.componentInstance.orderId = 'o1';
    httpMock.expectOne(ORDER_FACE_CHECK.ADMIN_GET('o1'))
      .flush({ ...CHECK, matchStatus: 'DIFFERENT', distance: 0.91 });

    f.componentInstance.verifier('REJETE');
    httpMock.expectOne(ORDER_FACE_CHECK.ADMIN_VERIFY('o1')).flush({ verificationStatus: 'REJETE' });

    expect(f.componentInstance.check()?.verificationStatus).toBe('REJETE');
  });
});
