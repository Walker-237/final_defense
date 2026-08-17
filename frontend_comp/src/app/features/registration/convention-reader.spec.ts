import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ConventionReaderDialog } from './convention-reader';
import { RegistrationService } from './registration-service';

function makeReg() {
  return {
    getConvention: vi.fn((): any => of({
      version: '2026-01', titre: 'Convention', contenuHtml: '<h1>Convention</h1><p>…</p>', langue: 'FR',
    })),
  };
}

describe('ConventionReaderDialog', () => {
  let reg: ReturnType<typeof makeReg>;

  function make() {
    reg = makeReg();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ConventionReaderDialog],
      providers: [{ provide: RegistrationService, useValue: reg }],
    });
    return TestBed.createComponent(ConventionReaderDialog).componentInstance;
  }

  it('charge la convention à l’ouverture', () => {
    const cmp = make();
    cmp.open = true;
    expect(reg.getConvention).toHaveBeenCalledWith('FR');
    expect(cmp.contenu()).toContain('Convention');
    expect(cmp.version()).toBe('2026-01');
  });

  it('ne recharge pas si déjà chargée', () => {
    const cmp = make();
    cmp.open = true;
    cmp.open = false;
    cmp.open = true;
    expect(reg.getConvention).toHaveBeenCalledOnce();
  });

  it('gère une erreur de chargement', () => {
    const cmp = make();
    reg.getConvention.mockReturnValueOnce(throwError(() => new Error('x')));
    cmp.open = true;
    expect(cmp.erreur()).toContain('indisponible');
  });

  it('le bouton d’acceptation est bloqué tant que le bas n’est pas atteint', () => {
    const cmp = make();
    cmp.open = true;
    expect(cmp.luJusquauBout()).toBe(false);
  });

  it('atteindre le bas du document débloque l’acceptation', () => {
    const cmp = make();
    cmp.open = true;
    // Simule un conteneur défilé jusqu'en bas.
    cmp.onScroll({ target: { scrollTop: 900, clientHeight: 100, scrollHeight: 1000 } } as unknown as Event);
    expect(cmp.luJusquauBout()).toBe(true);
  });

  it('ne débloque pas si le défilement est partiel', () => {
    const cmp = make();
    cmp.open = true;
    cmp.onScroll({ target: { scrollTop: 100, clientHeight: 100, scrollHeight: 1000 } } as unknown as Event);
    expect(cmp.luJusquauBout()).toBe(false);
  });

  it('émet confirm et cancel', () => {
    const cmp = make();
    const c = vi.fn(); const x = vi.fn();
    cmp.confirm.subscribe(c);
    cmp.cancel.subscribe(x);
    cmp.confirm.emit();
    cmp.cancel.emit();
    expect(c).toHaveBeenCalledOnce();
    expect(x).toHaveBeenCalledOnce();
  });
});
