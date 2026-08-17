import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID, Type } from '@angular/core';
import { of, throwError } from 'rxjs';
import { CoSignatures } from './cosignatures-page';
import { ApiService, CoSignatureItem } from '../../core/services/api';
import { ToastService } from '../../core/services/toast';
import { FaceCaptureResult } from '../registration/face-scan';

function item(over: Partial<CoSignatureItem> = {}): CoSignatureItem {
  return {
    orderId: 'or-1', reference: 'ORD-1', emissionCode: 'BTA-CMR-26-01', nature: 'BTA',
    volume: 10, montant: 100000, tauxSoumis: 5.8,
    expiresAt: new Date(Date.now() + 90_000).toISOString(), ...over,
  };
}

function face(over: Partial<FaceCaptureResult> = {}): FaceCaptureResult {
  return {
    imageBase64: 'data:image/jpeg;base64,IMG', landmarksJson: '[]',
    livenessScore: 0.95, livenessPassed: true, challengeType: 'BLINK',
    width: 480, height: 480, descriptor: [0.1, 0.2], ...over,
  };
}

let api: any, toast: any;

function makeFakes(list: CoSignatureItem[] = []) {
  api = {
    listPendingCoSignatures: vi.fn(() => of(list)),
    coSignOrder: vi.fn(() => of({})),
  };
  toast = { success: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function configure(list: CoSignatureItem[] = [], platform: 'browser' | 'server' = 'server') {
  makeFakes(list);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [CoSignatures],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: toast },
      { provide: PLATFORM_ID, useValue: platform },
    ],
  });
}

function create(): CoSignatures {
  return TestBed.createComponent(CoSignatures as Type<CoSignatures>).componentInstance;
}

describe('CoSignatures', () => {
  it('charge les validations en attente au montage', () => {
    configure([item(), item({ orderId: 'or-2' })]);
    const c = create();
    expect(api.listPendingCoSignatures).toHaveBeenCalled();
    expect(c.items().length).toBe(2);
    expect(c.loading()).toBe(false);
  });

  it('vide la liste en cas d’erreur', () => {
    configure();
    api.listPendingCoSignatures.mockReturnValueOnce(throwError(() => new Error('net')));
    const c = create();
    expect(c.items()).toEqual([]);
    expect(c.loading()).toBe(false);
  });

  it('remaining borne à zéro et countdown formate mm:ss', () => {
    configure();
    const c = create();
    const base = Date.now();
    c.now.set(base);
    const it = item({ expiresAt: new Date(base + 90_000).toISOString() });
    expect(c.remaining(it)).toBe(90);
    expect(c.countdown(it)).toBe('1:30');
    const expired = item({ expiresAt: new Date(base - 5_000).toISOString() });
    expect(c.remaining(expired)).toBe(0);
    expect(c.countdown(expired)).toBe('0:00');
  });

  it('refuser rejette une opération sans exiger de preuve', () => {
    configure();
    const c = create();
    c.refuser('or-1');
    expect(api.coSignOrder).toHaveBeenCalledWith('or-1', false, undefined);
    expect(toast.success).toHaveBeenCalledWith('Opération refusée', expect.any(String));
  });

  it('refuser signale un échec et recharge', () => {
    configure();
    const c = create();
    api.coSignOrder.mockReturnValueOnce(throwError(() => new Error('net')));
    api.listPendingCoSignatures.mockClear();
    c.refuser('or-1');
    expect(toast.error).toHaveBeenCalledWith('Échec', expect.any(String));
    expect(c.busy()).toBe(false);
    expect(api.listPendingCoSignatures).toHaveBeenCalled();
  });

  it('refuser est ignoré si une action est déjà en cours', () => {
    configure();
    const c = create();
    c.busy.set(true);
    c.refuser('or-1');
    expect(api.coSignOrder).not.toHaveBeenCalled();
  });

  // ── Validation : signature + visage exigés (comme à l'inscription) ──

  it('manquants énumère ce qui reste à fournir', () => {
    configure();
    const c = create();
    c.ouvrirValidation(item());
    expect(c.manquants()).toEqual(['capturer votre visage', 'apposer votre signature']);
    c.onFace(face());
    expect(c.manquants()).toEqual(['apposer votre signature']);
    c.signature = 'data:image/png;base64,SIG';
    expect(c.manquants()).toEqual([]);
  });

  it('ne valide pas tant que le visage ou la signature manque', () => {
    configure();
    const c = create();
    c.ouvrirValidation(item());
    c.confirmerValidation();
    expect(api.coSignOrder).not.toHaveBeenCalled();

    c.onFace(face());
    c.confirmerValidation();
    expect(api.coSignOrder).not.toHaveBeenCalled();
  });

  it('valide en transmettant signature et capture faciale', () => {
    configure();
    const c = create();
    api.listPendingCoSignatures.mockClear();
    c.ouvrirValidation(item());
    c.onFace(face());
    c.signature = 'data:image/png;base64,SIG';
    c.confirmerValidation();

    expect(api.coSignOrder).toHaveBeenCalledWith('or-1', true, {
      signatureData: 'data:image/png;base64,SIG',
      imageBase64: 'data:image/jpeg;base64,IMG',
      livenessScore: 0.95,
      challengeType: 'BLINK',
      descriptor: [0.1, 0.2],
    });
    expect(toast.success).toHaveBeenCalledWith('Opération validée', expect.any(String));
    expect(api.listPendingCoSignatures).toHaveBeenCalled();
    // Le dialogue se referme et n'garde aucune preuve en mémoire.
    expect(c.enCours()).toBeNull();
    expect(c.face()).toBeNull();
    expect(c.signature).toBe('');
  });

  it('un descripteur non calculable est omis plutôt qu’envoyé à null', () => {
    configure();
    const c = create();
    c.ouvrirValidation(item());
    c.onFace(face({ descriptor: null }));
    c.signature = 'data:image/png;base64,SIG';
    c.confirmerValidation();
    expect(api.coSignOrder.mock.calls[0][2].descriptor).toBeUndefined();
  });

  it('la capture du visage referme le scanner', () => {
    configure();
    const c = create();
    c.ouvrirValidation(item());
    c.scanActif.set(true);
    c.onFace(face());
    expect(c.scanActif()).toBe(false);
    c.reprendreFace();
    expect(c.face()).toBeNull();
    expect(c.scanActif()).toBe(true);
  });

  it('load remet loading à true puis à false', () => {
    configure([item()]);
    const c = create();
    c.load();
    expect(c.loading()).toBe(false);
    expect(c.items().length).toBe(1);
  });
});

describe('CoSignatures — horloge (navigateur)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('met à jour l’horloge chaque seconde et nettoie à la destruction', () => {
    configure([item()], 'browser');
    const c = create();
    const before = c.now();
    vi.advanceTimersByTime(1000);
    expect(c.now()).toBeGreaterThanOrEqual(before);
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    c.ngOnDestroy();
    expect(clearSpy).toHaveBeenCalled();
  });
});
