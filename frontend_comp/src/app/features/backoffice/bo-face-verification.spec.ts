import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { BoFaceVerification } from './bo-face-verification';
import { ADMIN_REGISTRATIONS } from '../../core/services/api-endpoints';

const CAPTURE = {
  dossier_id: 'd1', type_personne: 'PP', nom: 'NGONO', prenom: 'Alice',
  liveness_score: 0.92, verification_status: 'EN_ATTENTE' as const,
};
const DOSSIER = {
  dossierId: 'd1', statut: 'EN_ATTENTE_VERIFICATION', typePersonne: 'PP',
  compteEspeces: '1000500010000004320768', email: 'alice@example.cm',
  nom: 'NGONO', prenom: 'Alice', telephone: '+237690000000',
  pieces: [{ id: 'p1', cote: 'RECTO', document_type: 'CNI', imageBase64: 'data:image/jpeg;base64,BBB' }],
};
const FACE = {
  faceId: 'f1', imageBase64: 'data:image/jpeg;base64,AAA',
  landmarksJson: '[[0.5,0.5,0.1],[0.4,0.6,0.2]]', livenessScore: 0.92,
  challengeType: 'BLINK', width: 640, height: 480, verificationStatus: 'EN_ATTENTE',
};

describe('BoFaceVerification', () => {
  let httpMock: HttpTestingController;

  function make() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(),
        // Contexte navigateur pour déclencher le chargement dans ngAfterViewInit.
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });
    const fixture = TestBed.createComponent(BoFaceVerification);
    httpMock = TestBed.inject(HttpTestingController);
    return fixture;
  }

  afterEach(() => httpMock.verify());

  it('charge la file d’attente au démarrage', () => {
    const f = make();
    f.detectChanges(); // ngAfterViewInit
    httpMock.expectOne(ADMIN_REGISTRATIONS.LIST).flush([CAPTURE]);
    expect(f.componentInstance.captures()).toHaveLength(1);
    expect(f.componentInstance.captures()[0].nom).toBe('NGONO');
  });

  it('ouvre une capture : récupère image + repères', () => {
    const f = make();
    f.detectChanges();
    httpMock.expectOne(ADMIN_REGISTRATIONS.LIST).flush([CAPTURE]);

    f.componentInstance.ouvrir('d1');
    httpMock.expectOne(ADMIN_REGISTRATIONS.DOSSIER('d1')).flush(DOSSIER);
    httpMock.expectOne(ADMIN_REGISTRATIONS.FACE('d1')).flush(FACE);

    expect(f.componentInstance.selected()?.faceId).toBe('f1');
    expect(f.componentInstance.current).toBe('d1');
  });

  it('valide la capture et met à jour le statut affiché', () => {
    const f = make();
    f.detectChanges();
    httpMock.expectOne(ADMIN_REGISTRATIONS.LIST).flush([CAPTURE]);
    f.componentInstance.ouvrir('d1');
    httpMock.expectOne(ADMIN_REGISTRATIONS.DOSSIER('d1')).flush(DOSSIER);
    httpMock.expectOne(ADMIN_REGISTRATIONS.FACE('d1')).flush(FACE);

    f.componentInstance.verifier('VALIDE');
    const req = httpMock.expectOne(ADMIN_REGISTRATIONS.VERIFY('d1'));
    expect(req.request.body).toEqual({ status: 'VALIDE' });
    req.flush({ dossierId: 'd1', verificationStatus: 'VALIDE' });

    expect(f.componentInstance.selected()?.verificationStatus).toBe('VALIDE');
    expect(f.componentInstance.captures()[0].verification_status).toBe('VALIDE');
    expect(f.componentInstance.busy()).toBe(false);
  });

  it('rejette la capture', () => {
    const f = make();
    f.detectChanges();
    httpMock.expectOne(ADMIN_REGISTRATIONS.LIST).flush([CAPTURE]);
    f.componentInstance.ouvrir('d1');
    httpMock.expectOne(ADMIN_REGISTRATIONS.DOSSIER('d1')).flush(DOSSIER);
    httpMock.expectOne(ADMIN_REGISTRATIONS.FACE('d1')).flush(FACE);

    f.componentInstance.verifier('REJETE');
    httpMock.expectOne(ADMIN_REGISTRATIONS.VERIFY('d1')).flush({ verificationStatus: 'REJETE' });
    expect(f.componentInstance.selected()?.verificationStatus).toBe('REJETE');
  });

  it('libelle les statuts en français', () => {
    const f = make();
    f.detectChanges();
    httpMock.expectOne(ADMIN_REGISTRATIONS.LIST).flush([]);
    const c = f.componentInstance;
    expect(c.statutLabel('VALIDE')).toBe('Validée');
    expect(c.statutLabel('REJETE')).toBe('Rejetée');
    expect(c.statutLabel('EN_ATTENTE')).toBe('En attente');
  });
});
