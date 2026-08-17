import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ModalShell, OtpDialog, TwoSignDialog, ConfirmDialog } from './dialogs';

function mount<T>(cmp: new (...a: any[]) => T, inputs: Partial<T> = {}): {
  fixture: ComponentFixture<T>; cmp: T; el: HTMLElement;
} {
  TestBed.configureTestingModule({ imports: [cmp as any] });
  const fixture = TestBed.createComponent(cmp);
  Object.assign(fixture.componentInstance as object, inputs);
  fixture.detectChanges();
  return { fixture, cmp: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
}

/**
 * Ces composants exposent des `@Input` classiques : muter un champ ne notifie pas
 * le graphe de détection (mode zoneless). On marque donc la vue explicitement
 * avant de re-rendre, sinon `detectChanges()` saute la mise à jour et la passe de
 * vérification lève NG0100.
 */
function refresh(fixture: ComponentFixture<unknown>): void {
  fixture.componentRef.changeDetectorRef.markForCheck();
  fixture.detectChanges();
}

beforeEach(() => TestBed.resetTestingModule());

// ─── ModalShell ──────────────────────────────────────────────────────────────

describe('ModalShell', () => {
  it('ne rend rien quand open est faux', () => {
    const { el } = mount(ModalShell, { open: false });
    expect(el.querySelector('.fixed')).toBeNull();
  });

  it('rend le conteneur quand open est vrai', () => {
    const { el } = mount(ModalShell, { open: true });
    expect(el.querySelector('.fixed')).not.toBeNull();
  });

  it('émet cancel au clic sur le fond', () => {
    const { fixture, cmp, el } = mount(ModalShell, { open: true });
    const spy = vi.fn();
    cmp.cancel.subscribe(spy);

    el.querySelector<HTMLElement>('.fixed')!.click();
    fixture.detectChanges();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('n’émet pas cancel au clic à l’intérieur de la carte', () => {
    const { cmp, el } = mount(ModalShell, { open: true });
    const spy = vi.fn();
    cmp.cancel.subscribe(spy);

    el.querySelector<HTMLElement>('.card')!.click();
    expect(spy).not.toHaveBeenCalled();
  });

  it.each(['sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl'] as const)(
    'applique la classe de largeur pour la taille %s',
    (size) => {
      TestBed.resetTestingModule();
      const { el } = mount(ModalShell, { open: true, size });
      expect(el.querySelector('.card')!.classList).toContain(`max-w-${size}`);
    },
  );
});

// ─── OtpDialog ───────────────────────────────────────────────────────────────

describe('OtpDialog', () => {
  function open() {
    const m = mount(OtpDialog, { open: true });
    const inputs = Array.from(m.el.querySelectorAll<HTMLInputElement>('input'));
    return { ...m, inputs };
  }

  /** Simule une saisie clavier dans la case `idx`. */
  function type(cmp: OtpDialog, inputs: HTMLInputElement[], idx: number, value: string) {
    inputs[idx].value = value;
    cmp.onInput(idx, { target: inputs[idx] } as unknown as Event);
  }

  it('démarre avec six cases vides', () => {
    const { cmp, inputs } = open();
    expect(inputs).toHaveLength(6);
    expect(cmp.digits).toEqual(['', '', '', '', '', '']);
    expect(cmp.complete()).toBe(false);
  });

  it('complete() n’est vrai qu’avec six chiffres', () => {
    const { cmp } = open();
    cmp.digits = ['1', '2', '3', '4', '5', ''];
    expect(cmp.complete()).toBe(false);
    cmp.digits = ['1', '2', '3', '4', '5', '6'];
    expect(cmp.complete()).toBe(true);
  });

  it('onInput() ne retient qu’un chiffre et rejette les lettres', () => {
    const { cmp, inputs } = open();
    type(cmp, inputs, 0, 'a');
    expect(cmp.digits[0]).toBe('');
    expect(inputs[0].value).toBe('');

    type(cmp, inputs, 0, '7');
    expect(cmp.digits[0]).toBe('7');
  });

  it('onInput() tronque une saisie de plusieurs caractères', () => {
    const { cmp, inputs } = open();
    type(cmp, inputs, 0, '42');
    expect(cmp.digits[0]).toBe('4');
    expect(inputs[0].value).toBe('4');
  });

  it('onInput() avance le focus à la case suivante', () => {
    const { cmp, inputs } = open();
    type(cmp, inputs, 0, '1');
    expect(document.activeElement).toBe(inputs[1]);
  });

  it('onInput() n’avance pas au-delà de la dernière case', () => {
    const { cmp, inputs } = open();
    type(cmp, inputs, 5, '9');
    expect(cmp.digits[5]).toBe('9');
    expect(document.activeElement).not.toBe(inputs[0]);
  });

  it('Backspace sur une case vide recule le focus', () => {
    const { cmp, inputs } = open();
    cmp.onKey(2, new KeyboardEvent('keydown', { key: 'Backspace' }));
    expect(document.activeElement).toBe(inputs[1]);
  });

  it('Backspace sur une case remplie ne bouge pas le focus', () => {
    const { cmp, inputs } = open();
    cmp.digits[2] = '5';
    inputs[3].focus();
    cmp.onKey(2, new KeyboardEvent('keydown', { key: 'Backspace' }));
    expect(document.activeElement).toBe(inputs[3]);
  });

  it('les flèches déplacent le focus', () => {
    const { cmp, inputs } = open();
    cmp.onKey(2, new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(document.activeElement).toBe(inputs[1]);
    cmp.onKey(2, new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(document.activeElement).toBe(inputs[3]);
  });

  it('les flèches ne débordent pas des bornes', () => {
    const { cmp, inputs } = open();
    inputs[0].focus();
    cmp.onKey(0, new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(document.activeElement).toBe(inputs[0]);
    inputs[5].focus();
    cmp.onKey(5, new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(document.activeElement).toBe(inputs[5]);
  });

  it('onPaste() répartit un code complet et empêche l’action par défaut', () => {
    const { cmp, inputs } = open();
    const preventDefault = vi.fn();
    cmp.onPaste({
      clipboardData: { getData: () => '123456' }, preventDefault,
    } as unknown as ClipboardEvent);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(cmp.digits).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(inputs.map((i) => i.value)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(cmp.complete()).toBe(true);
  });

  it('onPaste() ignore les caractères non numériques et tronque à 6', () => {
    const { cmp } = open();
    cmp.onPaste({
      clipboardData: { getData: () => 'a1b2-3 4/5#6789' }, preventDefault: vi.fn(),
    } as unknown as ClipboardEvent);
    expect(cmp.digits).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('onPaste() d’un code partiel remplit le début et laisse le reste vide', () => {
    const { cmp } = open();
    cmp.onPaste({
      clipboardData: { getData: () => '123' }, preventDefault: vi.fn(),
    } as unknown as ClipboardEvent);
    expect(cmp.digits).toEqual(['1', '2', '3', '', '', '']);
    expect(cmp.complete()).toBe(false);
  });

  it('onPaste() sans contenu numérique ne fait rien', () => {
    const { cmp } = open();
    const preventDefault = vi.fn();
    cmp.onPaste({
      clipboardData: { getData: () => 'abc' }, preventDefault,
    } as unknown as ClipboardEvent);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(cmp.digits).toEqual(['', '', '', '', '', '']);
  });

  it('autofill() remplit 123456', () => {
    const { cmp, inputs } = open();
    cmp.autofill();
    expect(cmp.digits.join('')).toBe('123456');
    expect(inputs.map((i) => i.value).join('')).toBe('123456');
  });

  it('doConfirm() émet le code puis réinitialise', () => {
    const { cmp, inputs } = open();
    const spy = vi.fn();
    cmp.confirm.subscribe(spy);
    cmp.autofill();
    cmp.doConfirm();

    expect(spy).toHaveBeenCalledWith('123456');
    expect(cmp.digits).toEqual(['', '', '', '', '', '']);
    expect(inputs.every((i) => i.value === '')).toBe(true);
  });

  it('doConfirm() n’émet rien si le code est incomplet', () => {
    const { cmp } = open();
    const spy = vi.fn();
    cmp.confirm.subscribe(spy);
    cmp.digits = ['1', '2', '3', '', '', ''];
    cmp.doConfirm();
    expect(spy).not.toHaveBeenCalled();
  });

  it('doCancel() émet cancel et réinitialise', () => {
    const { cmp } = open();
    const spy = vi.fn();
    cmp.cancel.subscribe(spy);
    cmp.autofill();
    cmp.doCancel();
    expect(spy).toHaveBeenCalledOnce();
    expect(cmp.digits).toEqual(['', '', '', '', '', '']);
  });

  it('affiche le message par défaut, surchargeable', () => {
    const a = mount(OtpDialog, { open: true });
    expect(a.el.textContent).toContain('Saisissez le code OTP');

    TestBed.resetTestingModule();
    const b = mount(OtpDialog, { open: true, message: 'Message sur mesure' });
    expect(b.el.textContent).toContain('Message sur mesure');
  });

  it('le bouton Valider est désactivé tant que le code est incomplet', () => {
    const { fixture, cmp, el } = open();
    const valider = Array.from(el.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Valider'))!;
    expect(valider.disabled).toBe(true);

    cmp.autofill();
    refresh(fixture);
    expect(valider.disabled).toBe(false);
  });
});

// ─── TwoSignDialog ───────────────────────────────────────────────────────────

describe('TwoSignDialog', () => {
  const BON = 'MotDePasse1';

  function fill(cmp: TwoSignDialog, over: Partial<TwoSignDialog> = {}) {
    Object.assign(cmp, {
      sign1User: 'superviseur', sign1Pwd: BON,
      sign2User: 'responsable', sign2Pwd: BON,
      ...over,
    });
  }

  it('aucune signature valide au départ', () => {
    const { cmp } = mount(TwoSignDialog, { open: true });
    expect(cmp.sign1Ok()).toBe(false);
    expect(cmp.sign2Ok()).toBe(false);
    expect(cmp.canConfirm()).toBe(false);
  });

  it.each([
    ['court', 'Abc1'],
    ['sans chiffre', 'MotDePasse'],
    ['sans lettre', '12345678'],
    ['vide', ''],
  ])('refuse un mot de passe %s', (_cas, pwd) => {
    const { cmp } = mount(TwoSignDialog, { open: true });
    fill(cmp, { sign1Pwd: pwd });
    expect(cmp.sign1Ok()).toBe(false);
  });

  it('accepte un mot de passe de 8+ caractères avec lettre et chiffre', () => {
    const { cmp } = mount(TwoSignDialog, { open: true });
    fill(cmp);
    expect(cmp.sign1Ok()).toBe(true);
    expect(cmp.sign2Ok()).toBe(true);
  });

  it('exige un identifiant non vide', () => {
    const { cmp } = mount(TwoSignDialog, { open: true });
    fill(cmp, { sign1User: '' });
    expect(cmp.sign1Ok()).toBe(false);
  });

  it('canConfirm() exige deux signataires distincts', () => {
    const { cmp } = mount(TwoSignDialog, { open: true });
    fill(cmp, { sign2User: 'superviseur' });
    expect(cmp.sign1Ok()).toBe(true);
    expect(cmp.sign2Ok()).toBe(true);
    expect(cmp.canConfirm()).toBe(false);
  });

  it('canConfirm() ignore les espaces autour des identifiants', () => {
    const { cmp } = mount(TwoSignDialog, { open: true });
    fill(cmp, { sign1User: ' superviseur ', sign2User: 'superviseur' });
    expect(cmp.canConfirm()).toBe(false);
  });

  it('canConfirm() est vrai avec deux signatures valides et distinctes', () => {
    const { cmp } = mount(TwoSignDialog, { open: true });
    fill(cmp);
    expect(cmp.canConfirm()).toBe(true);
  });

  it('onConfirm() émet puis efface les identifiants de la mémoire', () => {
    const { cmp } = mount(TwoSignDialog, { open: true });
    const spy = vi.fn();
    cmp.confirm.subscribe(spy);
    fill(cmp);
    cmp.onConfirm();

    expect(spy).toHaveBeenCalledOnce();
    expect(cmp.sign1Pwd).toBe('');
    expect(cmp.sign2Pwd).toBe('');
    expect(cmp.sign1User).toBe('');
    expect(cmp.sign2User).toBe('');
  });

  it('onConfirm() n’émet rien quand les conditions ne sont pas réunies', () => {
    const { cmp } = mount(TwoSignDialog, { open: true });
    const spy = vi.fn();
    cmp.confirm.subscribe(spy);
    fill(cmp, { sign2User: 'superviseur' }); // signataires identiques
    cmp.onConfirm();
    expect(spy).not.toHaveBeenCalled();
    expect(cmp.sign1Pwd).toBe(BON); // rien effacé
  });

  it('ngOnDestroy() efface les secrets', () => {
    const { cmp } = mount(TwoSignDialog, { open: true });
    fill(cmp);
    cmp.ngOnDestroy();
    expect(cmp.sign1Pwd).toBe('');
    expect(cmp.sign2Pwd).toBe('');
  });

  it('le bouton de signature est désactivé tant que canConfirm() est faux', () => {
    const { fixture, cmp, el } = mount(TwoSignDialog, { open: true });
    const btn = Array.from(el.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Signer'))! as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    fill(cmp);
    refresh(fixture);
    expect(btn.disabled).toBe(false);
  });
});

// ─── ConfirmDialog ───────────────────────────────────────────────────────────

describe('ConfirmDialog', () => {
  it('affiche titre, message et libellé par défaut', () => {
    const { el } = mount(ConfirmDialog, { open: true, message: 'Êtes-vous sûr ?' });
    expect(el.textContent).toContain('Confirmation');
    expect(el.textContent).toContain('Êtes-vous sûr ?');
    expect(el.textContent).toContain('Confirmer');
  });

  it('honore un titre et un libellé personnalisés', () => {
    const { el } = mount(ConfirmDialog, {
      open: true, title: 'Supprimer', confirmLabel: 'Oui, supprimer',
    });
    expect(el.textContent).toContain('Supprimer');
    expect(el.textContent).toContain('Oui, supprimer');
  });

  it('applique le style primaire par défaut et danger sur demande', () => {
    const a = mount(ConfirmDialog, { open: true });
    const btnA = Array.from(a.el.querySelectorAll('button')).at(-1)!;
    expect(btnA.classList).toContain('btn-primary');

    TestBed.resetTestingModule();
    const b = mount(ConfirmDialog, { open: true, danger: true });
    const btnB = Array.from(b.el.querySelectorAll('button')).at(-1)!;
    expect(btnB.classList).toContain('btn-danger');
  });

  it('le bouton Annuler émet cancel', () => {
    const { cmp, el } = mount(ConfirmDialog, { open: true });
    const spy = vi.fn();
    cmp.cancel.subscribe(spy);
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Annuler'))!.click();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('le bouton de confirmation émet confirm', () => {
    const { cmp, el } = mount(ConfirmDialog, { open: true });
    const spy = vi.fn();
    cmp.confirm.subscribe(spy);
    Array.from(el.querySelectorAll('button')).at(-1)!.click();
    expect(spy).toHaveBeenCalledOnce();
  });
});
