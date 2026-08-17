import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { of, throwError, Subject, NEVER } from 'rxjs';

import { BoOtpSettings } from './bo-otp-settings';
import { ApiService, OtpSettings } from '../../core/services/api';
import { ToastService } from '../../core/services/toast';

function makeSettings(over: Partial<OtpSettings> = {}): OtpSettings {
  return {
    canal: 'EMAIL',
    longueur: 6,
    ttlSecondes: 300,
    maxTentatives: 5,
    smsApiUrl: 'https://sms.example/send',
    smsExpediteur: 'AFRILAND',
    smsApiKeySet: false,
    ...over,
  };
}

function makeToast() {
  return { success: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('BoOtpSettings', () => {
  let cmp: BoOtpSettings;
  let api: { getOtpSettings: ReturnType<typeof vi.fn>; updateOtpSettings: ReturnType<typeof vi.fn> };
  let toast: ReturnType<typeof makeToast>;

  function build(opts: { get?: () => any; update?: () => any } = {}) {
    TestBed.resetTestingModule();
    api = {
      getOtpSettings: vi.fn(opts.get ?? (() => of(makeSettings()))),
      updateOtpSettings: vi.fn(opts.update ?? ((b: any) => of(makeSettings(b)))),
    };
    toast = makeToast();
    TestBed.configureTestingModule({
      imports: [BoOtpSettings],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: toast },
      ],
    });
    cmp = TestBed.createComponent(BoOtpSettings).componentInstance;
  }

  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => vi.clearAllMocks());

  it('charge les paramètres à la construction', () => {
    build({ get: () => of(makeSettings({ canal: 'SMS', longueur: 8 })) });
    expect(api.getOtpSettings).toHaveBeenCalled();
    expect(cmp.loading()).toBe(false);
    expect(cmp.settings()?.canal).toBe('SMS');
    expect(cmp.form.longueur).toBe(8);
    expect(cmp.form.canal).toBe('SMS');
  });

  it('chargement en erreur arrête le spinner et notifie', () => {
    build({ get: () => throwError(() => new Error('down')) });
    expect(cmp.loading()).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Erreur', expect.any(String));
  });

  it('touchLongueur valide la plage 4–8', () => {
    build();
    cmp.form.longueur = 6;
    cmp.touchLongueur();
    expect(cmp.longueurErr).toBe('');
    cmp.form.longueur = 3;
    cmp.touchLongueur();
    expect(cmp.longueurErr).not.toBe('');
    cmp.form.longueur = 9;
    cmp.touchLongueur();
    expect(cmp.longueurErr).not.toBe('');
  });

  it('touchTtl valide la plage 60–1800', () => {
    build();
    cmp.form.ttlSecondes = 300;
    cmp.touchTtl();
    expect(cmp.ttlErr).toBe('');
    cmp.form.ttlSecondes = 30;
    cmp.touchTtl();
    expect(cmp.ttlErr).not.toBe('');
    cmp.form.ttlSecondes = 2000;
    cmp.touchTtl();
    expect(cmp.ttlErr).not.toBe('');
  });

  it('touchTentatives valide la plage 1–10', () => {
    build();
    cmp.form.maxTentatives = 5;
    cmp.touchTentatives();
    expect(cmp.tentativesErr).toBe('');
    cmp.form.maxTentatives = 0;
    cmp.touchTentatives();
    expect(cmp.tentativesErr).not.toBe('');
    cmp.form.maxTentatives = 11;
    cmp.touchTentatives();
    expect(cmp.tentativesErr).not.toBe('');
  });

  it('smsActive vrai pour SMS et EMAIL_SMS uniquement', () => {
    build();
    cmp.form.canal = 'EMAIL';
    expect(cmp.smsActive()).toBe(false);
    cmp.form.canal = 'LOG';
    expect(cmp.smsActive()).toBe(false);
    cmp.form.canal = 'SMS';
    expect(cmp.smsActive()).toBe(true);
    cmp.form.canal = 'EMAIL_SMS';
    expect(cmp.smsActive()).toBe(true);
  });

  it('save envoie le corps, vide la clé et notifie le succès', () => {
    build();
    cmp.form.canal = 'EMAIL_SMS';
    cmp.form.longueur = 6;
    cmp.form.ttlSecondes = 300;
    cmp.form.maxTentatives = 5;
    cmp.apiKey = '  ';
    cmp.save();
    expect(api.updateOtpSettings).toHaveBeenCalled();
    const body = api.updateOtpSettings.mock.calls[0][0];
    expect(body.canal).toBe('EMAIL_SMS');
    expect('smsApiKey' in body).toBe(false); // clé vide → non transmise
    expect(cmp.busy()).toBe(false);
    expect(cmp.apiKey).toBe('');
    expect(toast.success).toHaveBeenCalledWith('Enregistré', expect.any(String));
  });

  it('save transmet la clé d’API quand elle est saisie', () => {
    build();
    cmp.apiKey = 'secret-key';
    cmp.save();
    const body = api.updateOtpSettings.mock.calls[0][0];
    expect(body.smsApiKey).toBe('secret-key');
  });

  it('save applique des valeurs par défaut sur des champs invalides', () => {
    build();
    cmp.form.longueur = NaN as any;
    cmp.form.ttlSecondes = 0 as any;
    cmp.form.maxTentatives = NaN as any;
    cmp.save();
    const body = api.updateOtpSettings.mock.calls[0][0];
    expect(body.longueur).toBe(6);
    expect(body.ttlSecondes).toBe(300);
    expect(body.maxTentatives).toBe(5);
  });

  it('save en erreur arrête le busy et notifie', () => {
    build({ update: () => throwError(() => new Error('nope')) });
    cmp.save();
    expect(cmp.busy()).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Erreur', expect.any(String));
  });

  // ─── Rendu du gabarit ─────────────────────────────────────────────────────
  // Le gabarit est inline : ses branches comptent dans la couverture de lignes.

  describe('rendu', () => {
    /** Monte ET rend le composant, là où build() n'instancie que la classe. */
    function render(opts: { get?: () => any; update?: () => any } = {}) {
      TestBed.resetTestingModule();
      api = {
        getOtpSettings: vi.fn(opts.get ?? (() => of(makeSettings()))),
        updateOtpSettings: vi.fn(opts.update ?? ((b: any) => of(makeSettings(b)))),
      };
      toast = makeToast();
      TestBed.configureTestingModule({
        imports: [BoOtpSettings],
        providers: [
          { provide: ApiService, useValue: api },
          { provide: ToastService, useValue: toast },
        ],
      });
      const fixture = TestBed.createComponent(BoOtpSettings);
      fixture.detectChanges();
      return { fixture, cmp: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
    }

    /** `form` et les messages d'erreur sont des champs simples (mode zoneless). */
    function refresh(fixture: { componentRef: any; detectChanges: () => void }) {
      fixture.componentRef.changeDetectorRef.markForCheck();
      fixture.detectChanges();
    }

    const enregistrer = (el: HTMLElement) =>
      Array.from(el.querySelectorAll('button'))
        .find((b) => b.textContent?.trim() === 'Enregistrer') as HTMLButtonElement;

    it('affiche « Chargement… » tant que la réponse n’est pas arrivée', () => {
      const { el } = render({ get: () => NEVER });
      expect(el.textContent).toContain('Chargement…');
      expect(el.querySelector('.card-body')).toBeNull();
    });

    it('affiche le formulaire une fois la configuration chargée', () => {
      const { el } = render();
      expect(el.textContent).toContain('Génération');
      expect(el.querySelector<HTMLSelectElement>('select[name="canal"]')).not.toBeNull();
    });

    it('propose les quatre canaux de diffusion', () => {
      const { el } = render();
      const valeurs = Array.from(el.querySelectorAll('option')).map((o) => o.getAttribute('value'));
      expect(valeurs).toEqual(['EMAIL', 'SMS', 'EMAIL_SMS', 'LOG']);
    });

    it.each(['EMAIL', 'LOG'] as const)('masque la passerelle SMS pour le canal %s', (canal) => {
      const { el } = render({ get: () => of(makeSettings({ canal })) });
      expect(el.textContent).not.toContain('Passerelle SMS');
      expect(el.querySelector('input[name="smsUrl"]')).toBeNull();
    });

    it.each(['SMS', 'EMAIL_SMS'] as const)('affiche la passerelle SMS pour le canal %s', (canal) => {
      const { el } = render({ get: () => of(makeSettings({ canal })) });
      expect(el.textContent).toContain('Passerelle SMS');
      expect(el.querySelector('input[name="smsUrl"]')).not.toBeNull();
      expect(el.querySelector('input[name="apiKey"]')).not.toBeNull();
    });

    it('la section SMS apparaît quand on bascule le canal', () => {
      const { fixture, cmp, el } = render({ get: () => of(makeSettings({ canal: 'EMAIL' })) });
      expect(el.querySelector('input[name="smsUrl"]')).toBeNull();

      cmp.form.canal = 'SMS';
      refresh(fixture);
      expect(el.querySelector('input[name="smsUrl"]')).not.toBeNull();
    });

    it('signale une clé d’API SMS déjà définie', () => {
      const { el } = render({ get: () => of(makeSettings({ canal: 'SMS', smsApiKeySet: true })) });
      expect(el.textContent).toContain('● définie');
      expect(el.querySelector<HTMLInputElement>('input[name="apiKey"]')!.placeholder)
        .toContain('laisser vide = inchangé');
    });

    it('sans clé d’API définie, l’indicateur est absent', () => {
      const { el } = render({ get: () => of(makeSettings({ canal: 'SMS', smsApiKeySet: false })) });
      expect(el.textContent).not.toContain('● définie');
      expect(el.querySelector<HTMLInputElement>('input[name="apiKey"]')!.placeholder)
        .toBe("clé d'API SMS");
    });

    it('n’affiche aucun message de validation au départ', () => {
      const { el } = render();
      expect(el.querySelectorAll('p.text-red-600')).toHaveLength(0);
    });

    it.each([
      ['longueur', 'longueur', 99, 'Entre 4 et 8 chiffres.'],
      ['ttl', 'ttlSecondes', 10, 'Entre 60 et 1 800 secondes.'],
      ['maxt', 'maxTentatives', 42, 'Entre 1 et 10 tentatives.'],
    ] as const)('affiche l’erreur de validation du champ %s', (nom, champ, valeur, message) => {
      const { fixture, cmp, el } = render();
      (cmp.form as any)[champ] = valeur;
      el.querySelector<HTMLInputElement>(`input[name="${nom}"]`)!.dispatchEvent(new Event('blur'));
      refresh(fixture);

      expect(el.textContent).toContain(message);
      expect(el.querySelectorAll('p.text-red-600')).toHaveLength(1);
    });

    it('le message de validation disparaît quand la valeur redevient valide', () => {
      const { fixture, cmp, el } = render();
      cmp.form.longueur = 99;
      cmp.touchLongueur();
      refresh(fixture);
      expect(el.textContent).toContain('Entre 4 et 8 chiffres.');

      cmp.form.longueur = 6;
      cmp.touchLongueur();
      refresh(fixture);
      expect(el.textContent).not.toContain('Entre 4 et 8 chiffres.');
    });

    it('le bouton change de libellé et se désactive pendant l’enregistrement', () => {
      const { fixture, cmp, el } = render({ update: () => new Subject() });
      expect(enregistrer(el).disabled).toBe(false);

      cmp.save();
      refresh(fixture);

      expect(cmp.busy()).toBe(true);
      const occupe = Array.from(el.querySelectorAll('button'))
        .find((b) => b.textContent?.trim() === 'Enregistrement…') as HTMLButtonElement;
      expect(occupe.disabled).toBe(true);
    });

    it('un clic sur Enregistrer déclenche la sauvegarde', () => {
      const { el } = render();
      enregistrer(el).click();
      expect(api.updateOtpSettings).toHaveBeenCalledOnce();
    });

    it('après un échec de chargement, le formulaire n’est pas rendu et l’erreur est notifiée', () => {
      const { el } = render({ get: () => throwError(() => new Error('boom')) });
      expect(el.textContent).not.toContain('Chargement…');
      expect(toast.error).toHaveBeenCalledWith('Erreur', 'Chargement impossible.');
    });
  });
});
