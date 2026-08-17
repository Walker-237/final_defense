import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { FaceCheckService } from './face-check-service';
import { ORDER_FACE_CHECK } from '../../core/services/api-endpoints';
import { FaceCaptureResult } from './face-scan';

const FACE: FaceCaptureResult = {
  imageBase64: 'data:image/jpeg;base64,AAA',
  landmarksJson: '[]',
  livenessScore: 0.9,
  livenessPassed: true,
  challengeType: 'BLINK',
  width: 640,
  height: 480,
  descriptor: Array.from({ length: 128 }, () => 0.1),
};

describe('FaceCheckService', () => {
  let svc: FaceCheckService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), FaceCheckService],
    });
    svc = TestBed.inject(FaceCheckService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('envoie la photo du jour et l’empreinte sur le bon ordre', () => {
    const got = vi.fn();
    svc.checkOrder('o1', FACE).subscribe(got);

    const req = httpMock.expectOne(ORDER_FACE_CHECK.CHECK('o1'));
    expect(req.request.method).toBe('POST');
    expect(req.request.body.imageBase64).toBe(FACE.imageBase64);
    expect(req.request.body.descriptor).toHaveLength(128);
    // La géométrie 468 points n'est pas utile ici : seule l'empreinte sert.
    expect(req.request.body.landmarksJson).toBeUndefined();

    req.flush({ matchStatus: 'CORRESPOND', matched: true, distance: 0.3, seuil: 0.6 });
    expect(got).toHaveBeenCalledWith(expect.objectContaining({ matched: true }));
  });

  it('un visage différent est remonté sans erreur (l’ordre reste soumis)', () => {
    const got = vi.fn();
    svc.checkOrder('o1', FACE).subscribe(got);
    httpMock.expectOne(ORDER_FACE_CHECK.CHECK('o1'))
      .flush({ matchStatus: 'DIFFERENT', matched: false, distance: 0.92, seuil: 0.6 });

    expect(got).toHaveBeenCalledWith(expect.objectContaining({ matchStatus: 'DIFFERENT' }));
  });

  it('une panne du contrôle ne remonte JAMAIS d’erreur (l’ordre est déjà soumis)', () => {
    const got = vi.fn();
    const onError = vi.fn();
    svc.checkOrder('o1', FACE).subscribe({ next: got, error: onError });

    httpMock.expectOne(ORDER_FACE_CHECK.CHECK('o1'))
      .flush({}, { status: 500, statusText: 'Server Error' });

    expect(onError).not.toHaveBeenCalled();
    expect(got).toHaveBeenCalledWith(null);
  });
});
