import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, ActivatedRoute, provideRouter } from '@angular/router';
import { provideLocationMocks } from '@angular/common/testing';
import { signal } from '@angular/core';
import { of, throwError, Subject } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';

import {
  LoginPage, ChangePasswordPage, RegisterPPPage, RegisterPPLegacyPage,
  RegisterPMPage, MfaPage, ForgotPage, ResetPasswordPage,
} from './auth';
import { AuthService } from '../../core/services/auth-service';
import { MockData } from '../../core/services/mock-data';
import { RegistrationService } from '../registration/registration-service';

/** Double de RegistrationService : appels réseau renvoyant of() par défaut. */
function makeReg() {
  return {
    register: vi.fn((): any => of({
      dossierId: 'd1', titulaireId: 't1',
      auth: { accessToken: 'tok', tokenType: 'Bearer', expiresIn: 900 },
    })),
    uploadFace: vi.fn((): any => of({ faceId: 'f1' })),
    uploadPiece: vi.fn((): any => of({ pieceId: 'p1' })),
    // Sans soumission, le dossier resterait en brouillon : jamais examiné par la banque.
    submit: vi.fn((): any => of({ dossierId: 'd1', statut: 'EN_ATTENTE_VERIFICATION' })),
    setToken: vi.fn(),
    clearToken: vi.fn(),
    getDossier: vi.fn((): any => of({})),
    getConvention: vi.fn((): any => of({})),
  };
}

/** Pièce d'identité validée factice (CNI recto). */
function fakePiece() {
  return {
    imageBase64: 'data:image/jpeg;base64,BBB', cote: 'RECTO' as const,
    type: 'CNI' as const, texte: 'CARTE NATIONALE D IDENTITE NOM MBALLA',
    nettete: 300, largeur: 1200, hauteur: 800,
  };
}

/** Résultat de capture faciale factice. */
function fakeFace() {
  return {
    imageBase64: 'data:image/jpeg;base64,AAA', landmarksJson: '[]',
    livenessScore: 0.9, livenessPassed: true, challengeType: 'BLINK' as const,
    width: 640, height: 480, descriptor: null,
  };
}

// ─────────────────────────── Doubles de services ───────────────────────────

/** Double d'AuthService : chaque appel réseau renvoie of()/throwError selon le test. */
function makeAuth() {
  return {
    login: vi.fn((): any => of(undefined)),
    verifyMfa: vi.fn((): any => of('/client/dashboard')),
    changePassword: vi.fn((): any => of(undefined)),
    forgotPassword: vi.fn((): any => of(undefined)),
    resetPassword: vi.fn((): any => of(undefined)),
    cancelPending: vi.fn(),
    pendingChallenge: signal<any>(null),
    errorMessage: vi.fn((_e: unknown) => 'Identifiants incorrects.'),
  };
}

function makeRouter() {
  return { navigateByUrl: vi.fn(), navigate: vi.fn() };
}

/** ActivatedRoute minimal : seul `snapshot.queryParamMap.get(...)` est lu. */
function makeRoute(params: Record<string, string> = {}) {
  return { snapshot: { queryParamMap: new Map(Object.entries(params)) } };
}

/** QueryList factice pour les slots OTP (focus/select/value espionnés). */
function fakeSlots() {
  const map = Array.from({ length: 6 }, () => ({
    nativeElement: { focus: vi.fn(), select: vi.fn(), value: '' },
  }));
  return {
    map,
    get: (i: number) => map[i],
    forEach: (fn: (r: any) => void) => map.forEach(fn),
  } as any;
}

function build<T>(ctor: new () => T, providers: any[]): T {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers });
  return TestBed.runInInjectionContext(() => new ctor());
}

// Les écrans d'inscription projettent <afb-signature-pad> (canvas + ResizeObserver)
// que jsdom n'implémente pas : on stubbe ces API navigateur pour permettre le rendu.
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    strokeStyle: '', lineWidth: 0, lineCap: '', lineJoin: '',
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
    clearRect: vi.fn(), drawImage: vi.fn(), putImageData: vi.fn(),
    getImageData: vi.fn(() => ({}) as ImageData),
  } as any);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAA');
  vi.stubGlobal('ResizeObserver', class { observe = vi.fn(); disconnect = vi.fn(); });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ══════════════════════════════ LoginPage ═══════════════════════════════════

describe('LoginPage', () => {
  let auth: ReturnType<typeof makeAuth>;
  let router: ReturnType<typeof makeRouter>;

  function make(params: Record<string, string> = {}) {
    auth = makeAuth();
    router = makeRouter();
    return build(LoginPage, [
      { provide: AuthService, useValue: auth },
      { provide: Router, useValue: router },
      { provide: ActivatedRoute, useValue: makeRoute(params) },
    ]);
  }

  it('valide le format de l’e-mail au blur', () => {
    const cmp = make();
    cmp.email = '';
    cmp.touchEmail();
    expect(cmp.emailErr()).toBe("L'e-mail est requis.");
    cmp.email = 'pas-un-email';
    cmp.touchEmail();
    expect(cmp.emailErr()).toBe("Format d'e-mail invalide.");
    cmp.email = 'jean@d.cm';
    cmp.touchEmail();
    expect(cmp.emailErr()).toBe('');
  });

  it('valide la longueur du mot de passe', () => {
    const cmp = make();
    cmp.password = '';
    cmp.touchPassword();
    expect(cmp.passwordErr()).toBe('Le mot de passe est requis.');
    cmp.password = 'court';
    cmp.touchPassword();
    expect(cmp.passwordErr()).toBe('8 caractères minimum.');
    cmp.password = 'motdepasse1';
    cmp.touchPassword();
    expect(cmp.passwordErr()).toBe('');
  });

  it('n’appelle pas login si la saisie est invalide', () => {
    const cmp = make();
    cmp.email = 'jean@d.cm';
    cmp.password = ''; // invalide
    cmp.submit();
    expect(auth.login).not.toHaveBeenCalled();
  });

  it('login réussi ouvre le défi MFA et purge le mot de passe', () => {
    const cmp = make({ returnUrl: '/client/ordres' });
    cmp.email = 'jean@d.cm';
    cmp.password = 'motdepasse1';
    cmp.submit();
    expect(auth.login).toHaveBeenCalledWith('jean@d.cm', 'motdepasse1', '/client/ordres');
    expect(cmp.password).toBe('');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/auth/mfa');
    expect(cmp.loading()).toBe(false);
  });

  it('assainit un returnUrl hostile (anti open-redirect)', () => {
    const cmp = make({ returnUrl: 'http://evil.example/x' });
    cmp.email = 'jean@d.cm';
    cmp.password = 'motdepasse1';
    cmp.submit();
    expect(auth.login).toHaveBeenCalledWith('jean@d.cm', 'motdepasse1', '/');
  });

  it('surfaces le message d’erreur via AuthService.errorMessage', () => {
    const cmp = make();
    auth.login.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 401 })));
    cmp.email = 'jean@d.cm';
    cmp.password = 'motdepasse1';
    cmp.submit();
    expect(cmp.errorMsg()).toBe('Identifiants incorrects.');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(cmp.loading()).toBe(false);
  });

  it('active puis désactive le drapeau loading autour de l’appel', () => {
    const cmp = make();
    const gate = new Subject<void>();
    auth.login.mockReturnValueOnce(gate);
    cmp.email = 'jean@d.cm';
    cmp.password = 'motdepasse1';
    cmp.submit();
    expect(cmp.loading()).toBe(true);
    gate.next();
    gate.complete();
    expect(cmp.loading()).toBe(false);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/auth/mfa');
  });

  it('ignore une double soumission pendant le chargement', () => {
    const cmp = make();
    cmp.email = 'jean@d.cm';
    cmp.password = 'motdepasse1';
    cmp.loading.set(true);
    cmp.submit();
    expect(auth.login).not.toHaveBeenCalled();
  });
});

// ══════════════════════════ ChangePasswordPage ══════════════════════════════

describe('ChangePasswordPage', () => {
  let auth: ReturnType<typeof makeAuth>;
  let router: ReturnType<typeof makeRouter>;
  let data: { currentUser: ReturnType<typeof signal<any>> };

  function make(mustChange = false) {
    auth = makeAuth();
    router = makeRouter();
    data = { currentUser: signal<any>({ mustChangePassword: mustChange }) };
    return build(ChangePasswordPage, [
      { provide: AuthService, useValue: auth },
      { provide: Router, useValue: router },
      { provide: MockData, useValue: data },
    ]);
  }

  it('firstLogin reflète mustChangePassword', () => {
    expect(make(true).firstLogin()).toBe(true);
    expect(make(false).firstLogin()).toBe(false);
  });

  it('messages de validation des trois champs', () => {
    const cmp = make(false);
    cmp.current = '';
    cmp.touchCurrent();
    expect(cmp.currentErr()).toBe('Saisissez votre mot de passe actuel.');

    cmp.next = '';
    cmp.touchNext();
    expect(cmp.nextErr()).toBe('Saisissez le nouveau mot de passe.');
    cmp.next = 'court';
    cmp.touchNext();
    expect(cmp.nextErr()).toBe('8 caractères minimum.');
    cmp.current = 'Nouveau1!';
    cmp.next = 'Nouveau1!';
    cmp.touchNext();
    expect(cmp.nextErr()).toBe('Doit être différent du mot de passe actuel.');

    cmp.confirm = '';
    cmp.touchConfirm();
    expect(cmp.confirmErr()).toBe('Confirmez le nouveau mot de passe.');
    cmp.next = 'Nouveau1!';
    cmp.confirm = 'Autre1234';
    cmp.touchConfirm();
    expect(cmp.confirmErr()).toBe('Les mots de passe ne correspondent pas.');
  });

  it('changement volontaire : transmet le mot de passe actuel et redirige', () => {
    const cmp = make(false);
    cmp.current = 'Ancien12!';
    cmp.next = 'Nouveau1!';
    cmp.confirm = 'Nouveau1!';
    cmp.submit();
    expect(auth.changePassword).toHaveBeenCalledWith('Ancien12!', 'Nouveau1!');
    expect(router.navigate).toHaveBeenCalledWith(['/auth/login'], { queryParams: { changed: 1 } });
  });

  it('première connexion : omet le mot de passe actuel', () => {
    const cmp = make(true);
    cmp.next = 'Nouveau1!';
    cmp.confirm = 'Nouveau1!';
    cmp.submit();
    expect(auth.changePassword).toHaveBeenCalledWith(undefined, 'Nouveau1!');
  });

  it('n’appelle pas changePassword si les champs sont invalides', () => {
    const cmp = make(false);
    cmp.current = '';
    cmp.next = '';
    cmp.confirm = '';
    cmp.submit();
    expect(auth.changePassword).not.toHaveBeenCalled();
  });

  it('surfaces le message d’erreur serveur', () => {
    const cmp = make(true);
    auth.changePassword.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 400 })));
    cmp.next = 'Nouveau1!';
    cmp.confirm = 'Nouveau1!';
    cmp.submit();
    expect(cmp.errorMsg()).toBe('Identifiants incorrects.');
    expect(cmp.loading()).toBe(false);
  });
});

// ══════════════════════════════ MfaPage ═════════════════════════════════════

describe('MfaPage', () => {
  let auth: ReturnType<typeof makeAuth>;
  let router: ReturnType<typeof makeRouter>;

  function make() {
    auth = makeAuth();
    router = makeRouter();
    const cmp = build(MfaPage, [
      { provide: AuthService, useValue: auth },
      { provide: Router, useValue: router },
    ]);
    cmp.slotsEl = fakeSlots();
    return cmp;
  }

  it('hasPending / phoneHint reflètent le défi en attente', () => {
    const cmp = make();
    expect(cmp.hasPending()).toBe(false);
    expect(cmp.phoneHint()).toBe('');
    auth.pendingChallenge.set({ challengeId: 'ch-1', returnUrl: '/', phoneHint: '+237****89' });
    expect(cmp.hasPending()).toBe(true);
    expect(cmp.phoneHint()).toBe('+237****89');
  });

  it('complete() exige les six chiffres', () => {
    const cmp = make();
    expect(cmp.complete()).toBe(false);
    cmp.digits = ['1', '2', '3', '4', '5', '6'];
    expect(cmp.complete()).toBe(true);
  });

  it('onInput ne garde qu’un chiffre et avance le focus', () => {
    const cmp = make();
    const ev = { target: { value: '5x' } } as unknown as Event;
    cmp.onInput(0, ev);
    expect(cmp.digits[0]).toBe('5');
    expect((cmp.slotsEl as any).map[1].nativeElement.focus).toHaveBeenCalled();
  });

  it('onKey : Backspace sur case vide recule le focus', () => {
    const cmp = make();
    cmp.digits[1] = '';
    cmp.onKey(1, { key: 'Backspace' } as KeyboardEvent);
    expect((cmp.slotsEl as any).map[0].nativeElement.focus).toHaveBeenCalled();
  });

  it('onPaste répartit le code collé', () => {
    const cmp = make();
    const ev = {
      clipboardData: { getData: () => '123' },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent;
    cmp.onPaste(ev);
    expect(cmp.digits.slice(0, 3)).toEqual(['1', '2', '3']);
    expect((cmp.slotsEl as any).map[3].nativeElement.focus).toHaveBeenCalled();
  });

  it('go() vérifie l’OTP et redirige selon la réponse', () => {
    const cmp = make();
    auth.pendingChallenge.set({ challengeId: 'ch-1', returnUrl: '/' });
    auth.verifyMfa.mockReturnValueOnce(of('/backoffice/dashboard'));
    cmp.digits = ['1', '2', '3', '4', '5', '6'];
    cmp.go();
    expect(auth.verifyMfa).toHaveBeenCalledWith('123456');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/backoffice/dashboard');
    expect(cmp.loading()).toBe(false);
  });

  it('go() en échec affiche l’erreur et réinitialise les cases', () => {
    const cmp = make();
    auth.pendingChallenge.set({ challengeId: 'ch-1', returnUrl: '/' });
    auth.verifyMfa.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 401 })));
    cmp.digits = ['1', '2', '3', '4', '5', '6'];
    cmp.go();
    expect(cmp.errorMsg()).toBe('Identifiants incorrects.');
    expect(cmp.digits).toEqual(['', '', '', '', '', '']);
    expect((cmp.slotsEl as any).map[0].nativeElement.focus).toHaveBeenCalled();
    expect(cmp.loading()).toBe(false);
  });

  it('go() est ignoré sans défi en attente', () => {
    const cmp = make();
    cmp.digits = ['1', '2', '3', '4', '5', '6'];
    cmp.go();
    expect(auth.verifyMfa).not.toHaveBeenCalled();
  });

  it('cancel() efface le défi en cours', () => {
    const cmp = make();
    cmp.cancel();
    expect(auth.cancelPending).toHaveBeenCalled();
  });
});

// ══════════════════════════════ ForgotPage ══════════════════════════════════

describe('ForgotPage', () => {
  let auth: ReturnType<typeof makeAuth>;

  function make() {
    auth = makeAuth();
    return build(ForgotPage, [{ provide: AuthService, useValue: auth }]);
  }

  it('valide l’e-mail avant l’envoi', () => {
    const cmp = make();
    cmp.email = '';
    cmp.submit();
    expect(cmp.emailErr()).toBe("L'e-mail est requis.");
    expect(auth.forgotPassword).not.toHaveBeenCalled();
    cmp.email = 'pas-un-email';
    cmp.submit();
    expect(cmp.emailErr()).toBe("Format d'e-mail invalide.");
    expect(auth.forgotPassword).not.toHaveBeenCalled();
  });

  it('envoi réussi bascule en état « envoyé »', () => {
    const cmp = make();
    cmp.email = 'jean@d.cm';
    cmp.submit();
    expect(auth.forgotPassword).toHaveBeenCalledWith('jean@d.cm');
    expect(cmp.sent()).toBe(true);
    expect(cmp.loading()).toBe(false);
  });

  it('une erreur affiche tout de même l’état « envoyé » (anti-énumération)', () => {
    const cmp = make();
    auth.forgotPassword.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
    cmp.email = 'jean@d.cm';
    cmp.submit();
    expect(cmp.sent()).toBe(true);
    expect(cmp.loading()).toBe(false);
  });
});

// ═══════════════════════════ ResetPasswordPage ══════════════════════════════

describe('ResetPasswordPage', () => {
  let auth: ReturnType<typeof makeAuth>;

  function make(params: Record<string, string> = {}) {
    auth = makeAuth();
    return build(ResetPasswordPage, [
      { provide: AuthService, useValue: auth },
      { provide: ActivatedRoute, useValue: makeRoute(params) },
    ]);
  }

  it('lit le jeton depuis la query string', () => {
    expect(make({ token: 'tok-1' }).token).toBe('tok-1');
    expect(make().token).toBe('');
  });

  it('valide le nouveau mot de passe et sa confirmation', () => {
    const cmp = make({ token: 'tok-1' });
    cmp.next = '';
    cmp.touchNext();
    expect(cmp.nextErr()).toBe('Saisissez le nouveau mot de passe.');
    cmp.next = 'court';
    cmp.touchNext();
    expect(cmp.nextErr()).toBe('8 caractères minimum.');
    cmp.next = 'Nouveau1!';
    cmp.confirm = 'Autre1234';
    cmp.touchConfirm();
    expect(cmp.confirmErr()).toBe('Les mots de passe ne correspondent pas.');
  });

  it('réinitialisation réussie affiche l’état « terminé »', () => {
    const cmp = make({ token: 'tok-1' });
    cmp.next = 'Nouveau1!';
    cmp.confirm = 'Nouveau1!';
    cmp.submit();
    expect(auth.resetPassword).toHaveBeenCalledWith('tok-1', 'Nouveau1!');
    expect(cmp.done()).toBe(true);
    expect(cmp.loading()).toBe(false);
  });

  it('n’appelle pas resetPassword si la saisie est invalide', () => {
    const cmp = make({ token: 'tok-1' });
    cmp.next = '';
    cmp.confirm = '';
    cmp.submit();
    expect(auth.resetPassword).not.toHaveBeenCalled();
  });

  it('surfaces le message d’erreur serveur', () => {
    const cmp = make({ token: 'tok-1' });
    auth.resetPassword.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 400 })));
    cmp.next = 'Nouveau1!';
    cmp.confirm = 'Nouveau1!';
    cmp.submit();
    expect(cmp.errorMsg()).toBe('Identifiants incorrects.');
    expect(cmp.done()).toBe(false);
  });
});

// ═════════════════════ Écrans d'inscription (navigation) ════════════════════

describe('RegisterPPPage', () => {
  let router: ReturnType<typeof makeRouter>;
  let reg: ReturnType<typeof makeReg>;
  function make() {
    router = makeRouter();
    reg = makeReg();
    return build(RegisterPPPage, [
      { provide: Router, useValue: router },
      { provide: RegistrationService, useValue: reg },
    ]);
  }

  /** Formulaire complet valide (23 chiffres de compte, mots de passe concordants). */
  const formValide = () => ({
    accepte: true, nom: 'MBALLA', prenom: 'Jean', email: 'j@d.cm',
    password: 'MotDePasse1', password2: 'MotDePasse1',
    telephone: '699', compte: '10005 00090 56010090000 48',
  });

  /** Amène le composant à un état complet et soumettable. */
  function completer(cmp: RegisterPPPage) {
    cmp.form = formValide();
    cmp.faceResult.set(fakeFace());
    cmp.onPieces([fakePiece()]);
    cmp.onConventionLue();   // lecture intégrale → coche « J'accepte »
  }

  it('canSubmit exige mot de passe, compte de 23 chiffres, capture faciale, pièce d’identité et convention lue', () => {
    const cmp = make();
    expect(cmp.canSubmit()).toBe(false);

    cmp.form = formValide();
    expect(cmp.canSubmit()).toBe(false); // capture faciale manquante

    cmp.faceResult.set(fakeFace());
    expect(cmp.canSubmit()).toBe(false); // pièce d'identité manquante

    cmp.onPieces([fakePiece()]);
    expect(cmp.canSubmit()).toBe(false); // convention non lue

    cmp.onConventionLue();
    expect(cmp.canSubmit()).toBe(true);

    cmp.form.password2 = 'different';
    expect(cmp.canSubmit()).toBe(false); // mots de passe divergents
  });

  /** Le bouton ne doit JAMAIS être bloqué sans qu'on dise pourquoi. */
  it('manquants() énumère précisément ce qui reste à faire', () => {
    const cmp = make();
    const initial = cmp.manquants().join(' | ');
    expect(initial).toContain('nom');
    expect(initial).toContain('e-mail');
    expect(initial).toContain('mot de passe');
    expect(initial).toContain('23 chiffres');
    expect(initial).toContain('vérification faciale');
    expect(initial).toContain("pièce d'identité");
    expect(initial).toContain('convention');

    completer(cmp);
    expect(cmp.manquants()).toEqual([]);
  });

  it('manquants() signale des mots de passe divergents', () => {
    const cmp = make();
    completer(cmp);
    cmp.form.password2 = 'autre';
    expect(cmp.manquants().join(' ')).toContain('Confirmer le mot de passe');
  });

  it('submit inscrit, envoie la capture faciale PUIS la pièce d’identité, et redirige', () => {
    const cmp = make();
    cmp.submit(); // invalide → aucun appel
    expect(reg.register).not.toHaveBeenCalled();

    completer(cmp);
    cmp.submit();

    expect(reg.register).toHaveBeenCalledOnce();
    expect(reg.setToken).toHaveBeenCalledWith('tok');
    expect(reg.uploadFace).toHaveBeenCalledWith('d1', expect.objectContaining({ challengeType: 'BLINK' }));
    expect(reg.uploadPiece).toHaveBeenCalledWith('d1', expect.objectContaining({ type: 'CNI', cote: 'RECTO' }));
    expect(reg.submit).toHaveBeenCalledWith('d1');
    expect(router.navigate).toHaveBeenCalledWith(['/auth/login']);
  });

  /**
   * Une fois le dossier en base, le prospect n'a plus rien a faire sur ce
   * formulaire : on le renvoie a la connexion, sans le laisser en attente
   * derriere un bouton encore desactive ni conserver son jeton d'inscription.
   */
  it('une fois le dossier enregistre, redirige aussitot et ne garde rien', () => {
    const cmp = make();
    completer(cmp);
    cmp.submit();

    expect(router.navigate).toHaveBeenCalledWith(['/auth/login']);
    expect(reg.clearToken).toHaveBeenCalledOnce();
    expect(cmp.loading()).toBe(false);
  });

  /**
   * Le compte est créé AVANT l'envoi du visage et de la pièce. Si un envoi
   * échoue, re-cliquer ne doit PAS relancer `register` — sinon l'utilisateur
   * se heurte à « un compte existe déjà » et reste bloqué.
   */
  it('après un échec d’envoi, un nouveau clic REPREND sans recréer le compte', () => {
    const cmp = make();
    completer(cmp);

    // 1re tentative : le compte est créé, mais l'envoi de la pièce échoue.
    reg.uploadPiece.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
    cmp.submit();

    expect(reg.register).toHaveBeenCalledOnce();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(cmp.loading()).toBe(false);

    // 2e tentative : on NE recrée PAS le compte, on renvoie seulement la pièce.
    cmp.submit();

    expect(reg.register).toHaveBeenCalledOnce();          // toujours un seul register
    expect(reg.uploadPiece).toHaveBeenCalledTimes(2);     // la pièce est bien renvoyée
    expect(router.navigate).toHaveBeenCalledWith(['/auth/login']);
  });

  it('submit affiche une erreur si l’e-mail est déjà pris (409)', () => {
    const cmp = make();
    reg.register.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409 })));
    completer(cmp);
    cmp.submit();

    expect(reg.uploadFace).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(cmp.loading()).toBe(false);
  });
});

describe('RegisterPPLegacyPage', () => {
  let router: ReturnType<typeof makeRouter>;
  function make() {
    router = makeRouter();
    return build(RegisterPPLegacyPage, [{ provide: Router, useValue: router }]);
  }

  it('submit exige l’acceptation avant de rediriger vers le MFA', () => {
    const cmp = make();
    cmp.form.accepte = false;
    cmp.submit();
    expect(router.navigate).not.toHaveBeenCalled();
    cmp.form.accepte = true;
    cmp.submit();
    expect(router.navigate).toHaveBeenCalledWith(['/auth/mfa']);
  });
});

describe('RegisterPMPage', () => {
  it('s’instancie sans dépendance', () => {
    const cmp = build(RegisterPMPage, []);
    expect(cmp).toBeInstanceOf(RegisterPMPage);
  });
});

// ════════════ Rendu des gabarits (couverture des lignes de template) ════════════
// Les tests ci-dessus exercent les méthodes de classe sans jamais rendre le DOM.
// Comme ces composants utilisent des `template:` inline, les instructions du
// gabarit (@if / @else / @for) comptent pour la couverture de lignes : on rend
// donc chaque écran et on pilote chaque branche, puis on affirme ce que le DOM
// affiche réellement.

/** Rend un composant standalone avec un vrai Router (pour RouterLink). */
function render<T>(ctor: new () => T, providers: any[] = []) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideLocationMocks(), ...providers],
  });
  const fixture = TestBed.createComponent(ctor);
  fixture.detectChanges();
  return fixture;
}

/** Détection de changement après mutation d'un champ simple (zoneless). */
function sync(fixture: any) {
  fixture.componentRef.changeDetectorRef.markForCheck();
  fixture.detectChanges();
}

const text = (f: any) => (f.nativeElement as HTMLElement).textContent ?? '';
const submitBtn = (f: any) =>
  (f.nativeElement as HTMLElement).querySelector('button[type=submit]') as HTMLButtonElement;
const btnByText = (f: any, label: string) =>
  Array.from((f.nativeElement as HTMLElement).querySelectorAll('button'))
    .find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;

describe('LoginPage (rendu)', () => {
  const mk = () => render(LoginPage, [{ provide: AuthService, useValue: makeAuth() }]);

  it('affiche le formulaire de connexion par défaut', () => {
    const f = mk();
    expect((f.nativeElement as HTMLElement).querySelector('h1')?.textContent).toContain('Connexion');
    const btn = submitBtn(f);
    expect(btn.textContent?.trim()).toBe('Se connecter');
    expect(btn.disabled).toBe(false);
    expect((f.nativeElement as HTMLElement).querySelectorAll('p.text-red-600').length).toBe(0);
  });

  it('affiche les messages d’erreur de saisie et l’erreur serveur', () => {
    const f = mk();
    const c = f.componentInstance;
    c.email = ''; c.touchEmail();
    c.password = ''; c.touchPassword();
    c.errorMsg.set('Identifiants incorrects.');
    f.detectChanges();
    expect(text(f)).toContain("L'e-mail est requis.");
    expect(text(f)).toContain('Le mot de passe est requis.');
    expect(text(f)).toContain('Identifiants incorrects.');
  });

  it('désactive le bouton et change le libellé pendant le chargement', () => {
    const f = mk();
    f.componentInstance.loading.set(true);
    f.detectChanges();
    const btn = submitBtn(f);
    expect(btn.disabled).toBe(true);
    expect(btn.textContent?.trim()).toBe('Connexion…');
  });
});

describe('ChangePasswordPage (rendu)', () => {
  const mk = (mustChange: boolean) =>
    render(ChangePasswordPage, [
      { provide: AuthService, useValue: makeAuth() },
      { provide: MockData, useValue: { currentUser: signal<any>({ mustChangePassword: mustChange }) } },
    ]);

  it('masque le champ « mot de passe actuel » à la première connexion', () => {
    const f = mk(true);
    expect(text(f)).not.toContain('Mot de passe actuel');
    expect(text(f)).toContain('Nouveau mot de passe');
  });

  it('affiche le champ « mot de passe actuel » pour un changement volontaire', () => {
    expect(text(mk(false))).toContain('Mot de passe actuel');
  });

  it('rend les messages de validation et l’erreur serveur', () => {
    const f = mk(false);
    const c = f.componentInstance;
    c.current = ''; c.touchCurrent();
    c.next = 'court'; c.touchNext();
    c.confirm = 'autre'; c.touchConfirm();
    c.errorMsg.set('Erreur serveur.');
    f.detectChanges();
    expect(text(f)).toContain('Saisissez votre mot de passe actuel.');
    expect(text(f)).toContain('8 caractères minimum.');
    expect(text(f)).toContain('Les mots de passe ne correspondent pas.');
    expect(text(f)).toContain('Erreur serveur.');
  });

  it('désactive le bouton pendant l’enregistrement', () => {
    const f = mk(true);
    f.componentInstance.loading.set(true);
    f.detectChanges();
    const btn = submitBtn(f);
    expect(btn.disabled).toBe(true);
    expect(btn.textContent?.trim()).toBe('Enregistrement…');
  });
});

describe('RegisterPPPage (rendu)', () => {
  const mk = () => render(RegisterPPPage, [{ provide: RegistrationService, useValue: makeReg() }]);

  it('rend le formulaire avec un bouton désactivé tant qu’il est incomplet', () => {
    const f = mk();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('Ouvrir un compte-titres');
    const btn = submitBtn(f);
    expect(btn.textContent?.trim()).toBe('Créer mon compte');
    expect(btn.disabled).toBe(true);
    expect(el.querySelector('afb-signature-field')).toBeTruthy();
  });

  it('propose d’activer la caméra pour la vérification faciale', () => {
    const f = mk();
    expect(text(f)).toContain('Activer la caméra');
    // Tant qu'aucune capture n'est faite, le scanner n'est pas monté (pas de caméra).
    expect((f.nativeElement as HTMLElement).querySelector('afb-face-scan')).toBeNull();
  });

  it('active le bouton quand tout est saisi : visage capturé ET pièce d’identité', () => {
    const f = mk();
    f.componentInstance.form = {
      accepte: true, nom: 'M', prenom: 'J', email: 'j@d.cm',
      password: 'MotDePasse1', password2: 'MotDePasse1',
      telephone: '699', compte: '10005000905601009000048', signatureData: '',
    };
    f.componentInstance.faceResult.set(fakeFace());
    sync(f);
    // Sans pièce d'identité, la soumission reste impossible.
    expect(submitBtn(f).disabled).toBe(true);

    f.componentInstance.onPieces([fakePiece()]);
    f.componentInstance.onConventionLue();
    sync(f);
    expect(submitBtn(f).disabled).toBe(false);
  });

  /** Un bouton désactivé sans explication donne l'impression que « rien ne se passe ». */
  it('affiche ce qui manque tant que le bouton est désactivé', () => {
    const f = mk();
    sync(f);
    const t = text(f);
    expect(t).toContain('Pour créer votre compte, il reste à');
    expect(t).toContain('vérification faciale');
    expect(t).toContain("pièce d'identité");
    expect(submitBtn(f).disabled).toBe(true);
  });

  it('masque la liste des manques une fois le dossier complet', () => {
    const f = mk();
    f.componentInstance.form = {
      accepte: true, nom: 'M', prenom: 'J', email: 'j@d.cm',
      password: 'MotDePasse1', password2: 'MotDePasse1',
      telephone: '699', compte: '10005000905601009000048', signatureData: '',
    };
    f.componentInstance.faceResult.set(fakeFace());
    f.componentInstance.onPieces([fakePiece()]);
    f.componentInstance.onConventionLue();
    sync(f);
    expect(text(f)).not.toContain('Pour créer votre compte, il reste à');
  });
});

describe('RegisterPPLegacyPage (rendu)', () => {
  it('rend le formulaire KYC complet avec les titulaires en indivision', () => {
    const f = render(RegisterPPLegacyPage);
    const t = text(f);
    expect(t).toContain("Formulaire d'ouverture de compte de titres financiers");
    expect(t).toContain('Titulaire A');
    expect(t).toContain('Titulaire D'); // dernière itération de @for ['A','B','C','D']
    const submit = btnByText(f, 'Valider et soumettre')!;
    expect(submit.disabled).toBe(true); // ni acceptation ni signature
  });

  it('active « Valider et soumettre » avec acceptation et signature', () => {
    const f = render(RegisterPPLegacyPage);
    f.componentInstance.form.accepte = true;
    f.componentInstance.form.signatureData = 'data:image/png;base64,AAA';
    sync(f);
    expect(btnByText(f, 'Valider et soumettre')!.disabled).toBe(false);
  });
});

describe('RegisterPMPage (rendu)', () => {
  it('rend le formulaire statique « personne morale »', () => {
    const t = text(render(RegisterPMPage));
    expect(t).toContain('Personne Morale');
    expect(t).toContain('Représentants légaux');
    expect(t).toContain('Déposer le dossier');
  });
});

describe('MfaPage (rendu)', () => {
  function mk(pending: any = null) {
    const auth = makeAuth();
    auth.pendingChallenge.set(pending);
    return render(MfaPage, [{ provide: AuthService, useValue: auth }]);
  }

  it('sans défi en attente : avertit et désactive les six cases', () => {
    const f = mk(null);
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Aucune connexion en cours');
    expect(el.textContent).toContain('Saisissez le code OTP qui vous a été envoyé.');
    const slots = el.querySelectorAll('input');
    expect(slots.length).toBe(6);
    expect((slots[0] as HTMLInputElement).disabled).toBe(true);
    expect(btnByText(f, 'Valider')!.disabled).toBe(true);
  });

  it('avec défi et indice téléphonique : affiche le numéro masqué', () => {
    const f = mk({ challengeId: 'c', returnUrl: '/', phoneHint: '+237****89' });
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('+237****89');
    expect(el.textContent).not.toContain('Aucune connexion en cours');
    expect((el.querySelector('input') as HTMLInputElement).disabled).toBe(false);
  });

  it('affiche le message d’erreur et le libellé de vérification', () => {
    const f = mk({ challengeId: 'c', returnUrl: '/' });
    const c = f.componentInstance;
    c.errorMsg.set('Code invalide.');
    c.loading.set(true);
    f.detectChanges();
    expect(text(f)).toContain('Code invalide.');
    const btn = btnByText(f, 'Vérification…')!;
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);
  });
});

describe('ForgotPage (rendu)', () => {
  const mk = () => render(ForgotPage, [{ provide: AuthService, useValue: makeAuth() }]);

  it('affiche le formulaire puis l’état « envoyé »', () => {
    const f = mk();
    expect(submitBtn(f).textContent?.trim()).toBe('Envoyer le lien de réinitialisation');
    f.componentInstance.sent.set(true);
    f.detectChanges();
    expect(text(f)).toContain("un e-mail de réinitialisation vient d'être envoyé");
    expect((f.nativeElement as HTMLElement).querySelector('button[type=submit]')).toBeNull();
  });

  it('affiche les erreurs de saisie et l’état de chargement', () => {
    const f = mk();
    const c = f.componentInstance;
    c.email = ''; c.touchEmail();
    c.errorMsg.set('Service indisponible.');
    c.loading.set(true);
    f.detectChanges();
    expect(text(f)).toContain("L'e-mail est requis.");
    expect(text(f)).toContain('Service indisponible.');
    const btn = submitBtn(f);
    expect(btn.disabled).toBe(true);
    expect(btn.textContent?.trim()).toBe('Envoi…');
  });
});

describe('ResetPasswordPage (rendu)', () => {
  const mk = () => render(ResetPasswordPage, [{ provide: AuthService, useValue: makeAuth() }]);

  it('sans jeton : affiche un message de lien invalide', () => {
    const f = mk(); // route réelle sans query → token ''
    expect(text(f)).toContain('Lien de réinitialisation invalide');
    expect((f.nativeElement as HTMLElement).querySelector('form')).toBeNull();
  });

  it('avec jeton : affiche le formulaire et ses erreurs', () => {
    const f = mk();
    const c = f.componentInstance;
    c.token = 'tok-1';
    sync(f);
    expect((f.nativeElement as HTMLElement).querySelector('form')).toBeTruthy();
    c.next = 'court'; c.touchNext();
    c.confirm = 'autre'; c.touchConfirm();
    c.errorMsg.set('Jeton expiré.');
    f.detectChanges();
    expect(text(f)).toContain('8 caractères minimum.');
    expect(text(f)).toContain('Les mots de passe ne correspondent pas.');
    expect(text(f)).toContain('Jeton expiré.');
  });

  it('état « terminé » après réinitialisation réussie', () => {
    const f = mk();
    f.componentInstance.done.set(true);
    f.detectChanges();
    expect(text(f)).toContain('Votre mot de passe a été réinitialisé');
    expect(text(f)).toContain('Aller à la connexion');
  });
});
