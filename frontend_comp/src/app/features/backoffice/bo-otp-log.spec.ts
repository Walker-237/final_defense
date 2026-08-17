import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { BoOtpLog } from './bo-otp-log';
import { ApiService, OtpLogEntry } from '../../core/services/api';
import { ToastService } from '../../core/services/toast';

const flush = () => new Promise((r) => setTimeout(r));

let seq = 0;
function makeEntry(over: Partial<OtpLogEntry> = {}): OtpLogEntry {
  seq++;
  return {
    id: 'otp-' + seq,
    userId: 'u-' + seq,
    utilisateurNom: 'Jean Dupont',
    email: 'jean@d.cm',
    role: 'AGENT' as any,
    telephone: '699000000',
    code: '123456',
    attempts: 0,
    consumed: false,
    active: true,
    createdAt: '2026-06-15T09:00:00Z',
    expiresAt: '2026-06-15T09:05:00Z',
    ...over,
  };
}

function makePage(data: OtpLogEntry[]) {
  return { data, page: 1, size: 25, total: data.length };
}

function makeToast() {
  return { success: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('BoOtpLog', () => {
  let cmp: BoOtpLog;
  let api: { getOtpLog: ReturnType<typeof vi.fn> };
  let toast: ReturnType<typeof makeToast>;

  function build(getOtpLog: () => any = () => of(makePage([makeEntry()]))) {
    TestBed.resetTestingModule();
    api = { getOtpLog: vi.fn(getOtpLog) };
    toast = makeToast();
    TestBed.configureTestingModule({
      imports: [BoOtpLog],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: toast },
      ],
    });
    cmp = TestBed.createComponent(BoOtpLog).componentInstance;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(() => Promise.resolve()) },
      configurable: true,
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('charge les codes à la construction', () => {
    build(() => of(makePage([makeEntry(), makeEntry()])));
    expect(api.getOtpLog).toHaveBeenCalled();
    expect(cmp.entries()).toHaveLength(2);
    expect(cmp.loading()).toBe(false);
  });

  it('reload transmet la recherche et le filtre actif, et remet la page à 1', () => {
    build();
    cmp.page.set(4);
    cmp.q = 'jean';
    cmp.activeOnly = true;
    cmp.reload();
    expect(api.getOtpLog).toHaveBeenLastCalledWith('jean', true);
    expect(cmp.page()).toBe(1);
    expect(cmp.loading()).toBe(false);
  });

  it('reload en erreur arrête le spinner et notifie', () => {
    build(() => throwError(() => new Error('down')));
    expect(cmp.loading()).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Erreur', expect.any(String));
  });

  it('roleLabel traduit un rôle connu et retourne le brut sinon', () => {
    build();
    expect(cmp.roleLabel('AGENT')).toBe('Agent');
    expect(cmp.roleLabel('CLIENT_PP')).toBe('Client (PP)');
    expect(cmp.roleLabel('INCONNU')).toBe('INCONNU');
  });

  it('fmtDate renvoie un tiret pour une date absente ou invalide', () => {
    build();
    expect(cmp.fmtDate()).toBe('—');
    expect(cmp.fmtDate('')).toBe('—');
    expect(cmp.fmtDate('pas-une-date')).toBe('—');
  });

  it('fmtDate formate une date valide en local fr-FR', () => {
    build();
    const iso = '2026-06-15T09:00:00Z';
    expect(cmp.fmtDate(iso)).toBe(new Date(iso).toLocaleString('fr-FR'));
    expect(cmp.fmtDate(iso)).not.toBe('—');
  });

  it('copy copie le code et notifie le succès', async () => {
    build();
    cmp.copy('654321');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('654321');
    await flush();
    expect(toast.success).toHaveBeenCalledWith('Copié', expect.any(String));
  });

  it('copy ne fait rien sans code', () => {
    build();
    cmp.copy();
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('copy ne plante pas si le presse-papiers est indisponible', () => {
    build();
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    expect(() => cmp.copy('123')).not.toThrow();
  });

  it('copy ignore silencieusement un échec du presse-papiers', async () => {
    build();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(() => Promise.reject(new Error('nope'))) },
      configurable: true,
    });
    cmp.copy('123');
    await flush();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
