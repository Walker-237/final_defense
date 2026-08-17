import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { of, throwError, Subject, NEVER } from 'rxjs';
import { BoMailSettings } from './bo-mail-settings';
import { ApiService } from '../../core/services/api';
import { ToastService } from '../../core/services/toast';

function mailSettings(over: Record<string, unknown> = {}) {
  return {
    host: 'smtp.afriland.cm', port: 587, username: 'noreply',
    fromAddress: 'noreply@afriland.cm', fromName: 'Afriland First Bank',
    auth: true, starttls: true, enabled: true,
    logoUrl: null, signature: null, envManaged: false,
    ...over,
  } as any;
}

function makeToast() {
  return { success: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() };
}

let api: any;
let toast: ReturnType<typeof makeToast>;

/** Construit le composant. `get` pilote la réponse du chargement initial. */
function build(get: any = of(mailSettings())) {
  TestBed.resetTestingModule();
  toast = makeToast();
  api = {
    getMailSettings: vi.fn(() => get),
    updateMailSettings: vi.fn((b: any) => of(mailSettings(b))),
    testMailSettings: vi.fn(() => of({ status: 'SENT' })),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: toast },
    ],
  });
  return TestBed.runInInjectionContext(() => new BoMailSettings());
}

/** Variante rendue : le gabarit est inline, ses branches comptent dans la couverture. */
function render(get: any = of(mailSettings())) {
  TestBed.resetTestingModule();
  toast = makeToast();
  api = {
    getMailSettings: vi.fn(() => get),
    updateMailSettings: vi.fn((b: any) => of(mailSettings(b))),
    testMailSettings: vi.fn(() => of({ status: 'SENT' })),
  };
  TestBed.configureTestingModule({
    imports: [BoMailSettings],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: toast },
    ],
  });
  const fixture = TestBed.createComponent(BoMailSettings);
  fixture.detectChanges();
  return { fixture, cmp: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
}

/** `form` est un objet simple : le muter ne notifie pas le mode zoneless. */
function refresh(fixture: ComponentFixture<unknown>) {
  fixture.componentRef.changeDetectorRef.markForCheck();
  fixture.detectChanges();
}

function bouton(el: HTMLElement, libelle: string): HTMLButtonElement {
  return Array.from(el.querySelectorAll('button'))
    .find((b) => b.textContent?.trim() === libelle) as HTMLButtonElement;
}

describe('BoMailSettings', () => {
  beforeEach(() => vi.clearAllMocks());

  // ─── Chargement ───────────────────────────────────────────────────────────

  it('charge la configuration au démarrage et remplit le formulaire', () => {
    const cmp = build();
    expect(api.getMailSettings).toHaveBeenCalledOnce();
    expect(cmp.loading()).toBe(false);
    expect(cmp.form.host).toBe('smtp.afriland.cm');
    expect(cmp.form.port).toBe(587);
    expect(cmp.form.enabled).toBe(true);
  });

  it('remplace un logo et une signature absents par une chaîne vide', () => {
    const cmp = build(of(mailSettings({ logoUrl: null, signature: null })));
    expect(cmp.form.logoUrl).toBe('');
    expect(cmp.form.signature).toBe('');
  });

  it('signale une connexion SMTP imposée par l’environnement', () => {
    const cmp = build(of(mailSettings({ envManaged: true })));
    expect(cmp.envManaged()).toBe(true);
  });

  it('un échec de chargement arrête le spinner et notifie', () => {
    const cmp = build(throwError(() => new Error('boom')));
    expect(cmp.loading()).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Erreur', 'Chargement impossible.');
  });

  // ─── save() ───────────────────────────────────────────────────────────────

  it('save() envoie le formulaire et notifie le succès', () => {
    const cmp = build();
    cmp.form.host = 'nouveau.smtp';
    cmp.save();

    expect(api.updateMailSettings).toHaveBeenCalledOnce();
    expect(api.updateMailSettings.mock.calls[0][0]).toMatchObject({ host: 'nouveau.smtp' });
    expect(cmp.busy()).toBe(false);
    expect(toast.success).toHaveBeenCalledWith('Enregistré', 'Paramètres de messagerie mis à jour.');
  });

  it('save() omet le mot de passe quand il est vide (conservé côté serveur)', () => {
    const cmp = build();
    cmp.password = '   ';
    cmp.save();
    expect(api.updateMailSettings.mock.calls[0][0]).not.toHaveProperty('password');
  });

  it('save() transmet le mot de passe quand il est renseigné, puis l’efface', () => {
    const cmp = build();
    cmp.password = 'secret';
    cmp.save();
    expect(api.updateMailSettings.mock.calls[0][0]).toMatchObject({ password: 'secret' });
    expect(cmp.password).toBe('');
  });

  it('save() retombe sur le port 587 quand le port est invalide', () => {
    const cmp = build();
    cmp.form.port = '' as unknown as number;
    cmp.save();
    expect(api.updateMailSettings.mock.calls[0][0]).toMatchObject({ port: 587 });
  });

  it('save() convertit un port saisi en texte', () => {
    const cmp = build();
    cmp.form.port = '2525' as unknown as number;
    cmp.save();
    expect(api.updateMailSettings.mock.calls[0][0]).toMatchObject({ port: 2525 });
  });

  it('save() en échec libère le drapeau busy et notifie', () => {
    const cmp = build();
    api.updateMailSettings.mockReturnValue(throwError(() => new Error('nope')));
    cmp.save();
    expect(cmp.busy()).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Erreur', 'Enregistrement impossible.');
  });

  // ─── sendTest() ───────────────────────────────────────────────────────────

  it('sendTest() refuse une adresse sans arobase, sans appel réseau', () => {
    const cmp = build();
    cmp.testTo = 'pas-un-email';
    cmp.sendTest();

    expect(api.updateMailSettings).not.toHaveBeenCalled();
    expect(api.testMailSettings).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Adresse invalide', 'Renseignez une adresse e-mail de test.');
  });

  it('sendTest() enregistre la configuration affichée avant d’envoyer le test', () => {
    const cmp = build();
    cmp.form.host = 'smtp.test';
    cmp.testTo = ' a@b.cm ';
    cmp.sendTest();

    expect(api.updateMailSettings).toHaveBeenCalledOnce();
    expect(api.testMailSettings).toHaveBeenCalledWith('a@b.cm');
    expect(cmp.busy()).toBe(false);
    expect(toast.success).toHaveBeenCalledWith('Test envoyé', 'E-mail de test envoyé à a@b.cm.');
  });

  it('sendTest() efface le mot de passe une fois la configuration enregistrée', () => {
    const cmp = build();
    cmp.password = 'secret';
    cmp.testTo = 'a@b.cm';
    cmp.sendTest();
    expect(cmp.password).toBe('');
  });

  it('sendTest() avertit en mode simulation', () => {
    const cmp = build();
    api.testMailSettings.mockReturnValue(of({ status: 'SIMULATED' }));
    cmp.testTo = 'a@b.cm';
    cmp.sendTest();
    expect(toast.warn).toHaveBeenCalledWith('Mode simulation', expect.stringContaining('SMTP'));
  });

  it('sendTest() signale un statut d’échec renvoyé par le serveur', () => {
    const cmp = build();
    api.testMailSettings.mockReturnValue(of({ status: 'FAILED' }));
    cmp.testTo = 'a@b.cm';
    cmp.sendTest();
    expect(toast.error).toHaveBeenCalledWith('Échec', expect.stringContaining('identifiants SMTP'));
  });

  it('sendTest() gère une erreur réseau', () => {
    const cmp = build();
    api.testMailSettings.mockReturnValue(throwError(() => new Error('down')));
    cmp.testTo = 'a@b.cm';
    cmp.sendTest();
    expect(cmp.busy()).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Erreur', 'Test impossible.');
  });

  it('sendTest() gère un échec de l’enregistrement préalable', () => {
    const cmp = build();
    api.updateMailSettings.mockReturnValue(throwError(() => new Error('save ko')));
    cmp.testTo = 'a@b.cm';
    cmp.sendTest();

    expect(api.testMailSettings).not.toHaveBeenCalled();
    expect(cmp.busy()).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Erreur', 'Test impossible.');
  });

  // ─── Rendu du gabarit ─────────────────────────────────────────────────────

  describe('rendu', () => {
    it('affiche « Chargement… » tant que la réponse n’est pas arrivée', () => {
      const { el } = render(NEVER);
      expect(el.textContent).toContain('Chargement…');
      expect(el.querySelector('.card-body')).toBeNull();
    });

    it('affiche le formulaire une fois la configuration chargée', () => {
      const { el } = render();
      expect(el.textContent).not.toContain('Chargement…');
      expect(el.querySelector('.card-body')).not.toBeNull();
      expect(el.textContent).toContain('Serveur SMTP');
    });

    it('le badge reflète l’état d’activation', () => {
      const actif = render(of(mailSettings({ enabled: true })));
      expect(actif.el.querySelector('.badge')!.textContent!.trim()).toBe('Activée');

      const inactif = render(of(mailSettings({ enabled: false })));
      expect(inactif.el.querySelector('.badge')!.textContent!.trim()).toBe('Désactivée');
    });

    it('n’affiche pas la bannière « imposé par l’environnement » par défaut', async () => {
      const { fixture, el } = render();
      expect(el.textContent).not.toContain("imposée par les variables d'environnement");
      await fixture.whenStable();
      fixture.detectChanges();
      expect(el.querySelector<HTMLInputElement>('input[name="host"]')!.disabled).toBe(false);
    });

    it('en mode envManaged, la bannière apparaît et les champs SMTP sont verrouillés', async () => {
      const { fixture, el } = render(of(mailSettings({ envManaged: true })));
      expect(el.textContent).toContain("imposée par les variables d'environnement");

      // `NgModel` applique l'état désactivé de façon asynchrone (promesse résolue).
      await fixture.whenStable();
      fixture.detectChanges();

      for (const nom of ['host', 'port', 'username', 'password', 'fromAddress', 'fromName', 'enabled', 'auth', 'starttls']) {
        expect(el.querySelector<HTMLInputElement>(`input[name="${nom}"]`)!.disabled, nom).toBe(true);
      }
      // Logo et signature restent modifiables.
      expect(el.querySelector<HTMLInputElement>('input[name="logoUrl"]')!.disabled).toBe(false);
      expect(el.querySelector<HTMLTextAreaElement>('textarea[name="signature"]')!.disabled).toBe(false);
    });

    it('signale un mot de passe déjà défini côté serveur', () => {
      const { el } = render(of(mailSettings({ passwordSet: true })));
      expect(el.textContent).toContain('● défini');
      expect(el.querySelector<HTMLInputElement>('input[name="password"]')!.placeholder)
        .toContain('laisser vide = inchangé');
    });

    it('sans mot de passe défini, l’indicateur est absent', () => {
      const { el } = render(of(mailSettings({ passwordSet: false })));
      expect(el.textContent).not.toContain('● défini');
      expect(el.querySelector<HTMLInputElement>('input[name="password"]')!.placeholder)
        .toBe('mot de passe SMTP');
    });

    it('l’aperçu du logo retombe sur le logo Afriland quand l’URL est vide', () => {
      const { el } = render(of(mailSettings({ logoUrl: '' })));
      expect(el.querySelector('img')!.getAttribute('src')).toBe('/Logo_Afriland.png');
    });

    it('l’aperçu du logo affiche l’URL saisie', () => {
      const { el } = render(of(mailSettings({ logoUrl: 'https://x/logo.png' })));
      expect(el.querySelector('img')!.getAttribute('src')).toBe('https://x/logo.png');
    });

    it('les boutons changent de libellé et se désactivent pendant un traitement', () => {
      const { fixture, cmp, el } = render();
      expect(bouton(el, 'Enregistrer').disabled).toBe(false);
      expect(bouton(el, 'Envoyer un test').disabled).toBe(false);

      // Une sauvegarde qui n'aboutit jamais laisse le composant occupé.
      api.updateMailSettings.mockReturnValue(new Subject());
      cmp.save();
      refresh(fixture);

      expect(cmp.busy()).toBe(true);
      expect(bouton(el, 'Enregistrement…').disabled).toBe(true);
      expect(bouton(el, '…').disabled).toBe(true);
    });

    it('un clic sur Enregistrer déclenche la sauvegarde', () => {
      const { el } = render();
      bouton(el, 'Enregistrer').click();
      expect(api.updateMailSettings).toHaveBeenCalledOnce();
    });

    it('un clic sur « Envoyer un test » sans adresse est refusé', () => {
      const { el } = render();
      bouton(el, 'Envoyer un test').click();
      expect(api.testMailSettings).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith('Adresse invalide', 'Renseignez une adresse e-mail de test.');
    });

    it('après un échec de chargement, ni spinner ni formulaire ne restent bloqués', () => {
      const { el } = render(throwError(() => new Error('boom')));
      expect(el.textContent).not.toContain('Chargement…');
      expect(toast.error).toHaveBeenCalledWith('Erreur', 'Chargement impossible.');
    });
  });
});
