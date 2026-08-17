import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { BoConnectionQr } from './bo-connection-qr';
import { ApiService, ConnectionQr } from '../../core/services/api';
import { ToastService } from '../../core/services/toast';

const flush = () => new Promise((r) => setTimeout(r));

function makeQr(over: Partial<ConnectionQr> = {}): ConnectionQr {
  return { url: 'https://titres.example/login', qrCodeDataUrl: 'data:image/png;base64,AAAA', ...over };
}

function makeToast() {
  return { success: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('BoConnectionQr', () => {
  let cmp: BoConnectionQr;
  let api: { getConnectionQr: ReturnType<typeof vi.fn> };
  let toast: ReturnType<typeof makeToast>;

  function build(getConnectionQr: () => any = () => of(makeQr())) {
    TestBed.resetTestingModule();
    api = { getConnectionQr: vi.fn(getConnectionQr) };
    toast = makeToast();
    TestBed.configureTestingModule({
      imports: [BoConnectionQr],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: toast },
      ],
    });
    cmp = TestBed.createComponent(BoConnectionQr).componentInstance;
    cmp.ngOnInit(); // charge le QR (déclenché en pratique par le cycle de vie)
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(() => Promise.resolve()) },
      configurable: true,
    });
    (HTMLAnchorElement.prototype as any).click = vi.fn();
    window.open = vi.fn(() => ({ document: { write: vi.fn(), close: vi.fn() } })) as any;
  });
  afterEach(() => vi.restoreAllMocks());

  it('ngOnInit déclenche le chargement du QR', () => {
    build();
    cmp.ngOnInit();
    expect(api.getConnectionQr).toHaveBeenCalled();
    expect(cmp.qr()).not.toBeNull();
    expect(cmp.loading()).toBe(false);
  });

  it('reload succès renseigne le QR et arrête le chargement', () => {
    build(() => of(makeQr({ url: 'https://x/login' })));
    cmp.reload();
    expect(cmp.qr()?.url).toBe('https://x/login');
    expect(cmp.loading()).toBe(false);
  });

  it('reload erreur arrête le chargement et notifie', () => {
    build(() => throwError(() => new Error('boom')));
    cmp.reload();
    expect(cmp.loading()).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Erreur', expect.any(String));
  });

  it('selectAll sélectionne le contenu de l’input', () => {
    build();
    const select = vi.fn();
    cmp.selectAll({ target: { select } } as unknown as Event);
    expect(select).toHaveBeenCalled();
  });

  it('copy ne fait rien sans URL', () => {
    build(() => of(null));
    cmp.reload();
    cmp.copy();
    expect((navigator.clipboard.writeText as any)).not.toHaveBeenCalled();
  });

  it('copy réussie copie le lien et notifie le succès', async () => {
    build();
    cmp.copy();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://titres.example/login');
    await flush();
    expect(toast.success).toHaveBeenCalledWith('Copié', expect.any(String));
  });

  it('copy échouée notifie l’erreur', async () => {
    build();
    (navigator.clipboard.writeText as any) = vi.fn(() => Promise.reject(new Error('nope')));
    cmp.copy();
    await flush();
    expect(toast.error).toHaveBeenCalledWith('Erreur', expect.any(String));
  });

  it('download ne fait rien sans data URL', () => {
    build(() => of(null));
    cmp.reload();
    cmp.download();
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });

  it('download déclenche un téléchargement PNG', () => {
    build();
    cmp.download();
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
  });

  it('print ne fait rien sans data URL', () => {
    build(() => of(null));
    cmp.reload();
    cmp.print();
    expect(window.open).not.toHaveBeenCalled();
  });

  it('print ouvre une fenêtre et écrit le document', () => {
    const doc = { write: vi.fn(), close: vi.fn() };
    window.open = vi.fn(() => ({ document: doc })) as any;
    build();
    cmp.print();
    expect(window.open).toHaveBeenCalled();
    expect(doc.write).toHaveBeenCalled();
    expect(doc.close).toHaveBeenCalled();
  });

  it('print signale un pop-up bloqué', () => {
    window.open = vi.fn(() => null) as any;
    build();
    cmp.print();
    expect(toast.error).toHaveBeenCalledWith('Pop-up bloqué', expect.any(String));
  });
});
