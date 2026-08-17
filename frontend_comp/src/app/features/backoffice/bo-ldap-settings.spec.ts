import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { of, throwError, Subject, NEVER } from 'rxjs';
import { BoLdapSettings } from './bo-ldap-settings';
import { ApiService } from '../../core/services/api';
import { ToastService } from '../../core/services/toast';

function ldapSettings(over: Record<string, unknown> = {}) {
  return {
    enabled: true, host: 'ldap.afriland.cm', port: 389, ssl: false, startTls: true,
    baseDn: 'dc=afriland,dc=cm', bindDn: 'cn=svc,dc=afriland,dc=cm',
    userSearchBase: 'ou=users', userSearchFilter: '(uid={0})',
    ...over,
  } as any;
}

function makeToast() {
  return { success: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() };
}

let api: any;
let toast: ReturnType<typeof makeToast>;

function build(get: any = of(ldapSettings())) {
  TestBed.resetTestingModule();
  toast = makeToast();
  api = {
    getLdapSettings: vi.fn(() => get),
    updateLdapSettings: vi.fn((b: any) => of(ldapSettings(b))),
    testLdapSettings: vi.fn(() => of({ ok: true, message: 'Liaison OK' })),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: toast },
    ],
  });
  return TestBed.runInInjectionContext(() => new BoLdapSettings());
}

/** Variante rendue : le gabarit est inline, ses branches comptent dans la couverture. */
function render(get: any = of(ldapSettings())) {
  TestBed.resetTestingModule();
  toast = makeToast();
  api = {
    getLdapSettings: vi.fn(() => get),
    updateLdapSettings: vi.fn((b: any) => of(ldapSettings(b))),
    testLdapSettings: vi.fn(() => of({ ok: true, message: 'Liaison OK' })),
  };
  TestBed.configureTestingModule({
    imports: [BoLdapSettings],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: toast },
    ],
  });
  const fixture = TestBed.createComponent(BoLdapSettings);
  fixture.detectChanges();
  return { fixture, cmp: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
}

function bouton(el: HTMLElement, libelle: string): HTMLButtonElement {
  return Array.from(el.querySelectorAll('button'))
    .find((b) => b.textContent?.trim() === libelle) as HTMLButtonElement;
}

describe('BoLdapSettings', () => {
  beforeEach(() => vi.clearAllMocks());

  // ─── Chargement ───────────────────────────────────────────────────────────

  it('charge la configuration au démarrage', () => {
    const cmp = build();
    expect(api.getLdapSettings).toHaveBeenCalledOnce();
    expect(cmp.loading()).toBe(false);
    expect(cmp.form.host).toBe('ldap.afriland.cm');
    expect(cmp.form.userSearchFilter).toBe('(uid={0})');
  });

  it('retombe sur le filtre de recherche par défaut quand il est vide', () => {
    const cmp = build(of(ldapSettings({ userSearchFilter: '' })));
    expect(cmp.form.userSearchFilter).toBe('(sAMAccountName={0})');
  });

  it('un échec de chargement arrête le spinner et notifie', () => {
    const cmp = build(throwError(() => new Error('boom')));
    expect(cmp.loading()).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Erreur', 'Chargement impossible.');
  });

  // ─── Exclusivité SSL / STARTTLS ───────────────────────────────────────────

  describe('onSsl()', () => {
    it('activer SSL désactive STARTTLS et bascule le port 389 → 636', () => {
      const cmp = build();
      cmp.form.startTls = true;
      cmp.form.port = 389;
      cmp.form.ssl = true;
      cmp.onSsl();

      expect(cmp.form.startTls).toBe(false);
      expect(cmp.form.port).toBe(636);
    });

    it('activer SSL ne touche pas à un port personnalisé', () => {
      const cmp = build();
      cmp.form.port = 3269;
      cmp.form.ssl = true;
      cmp.onSsl();
      expect(cmp.form.port).toBe(3269);
    });

    it('désactiver SSL ramène le port 636 → 389', () => {
      const cmp = build();
      cmp.form.port = 636;
      cmp.form.ssl = false;
      cmp.onSsl();
      expect(cmp.form.port).toBe(389);
    });

    it('désactiver SSL laisse un port personnalisé intact', () => {
      const cmp = build();
      cmp.form.port = 1389;
      cmp.form.ssl = false;
      cmp.onSsl();
      expect(cmp.form.port).toBe(1389);
    });
  });

  describe('onStartTls()', () => {
    it('activer STARTTLS désactive SSL et ramène le port 636 → 389', () => {
      const cmp = build();
      cmp.form.ssl = true;
      cmp.form.port = 636;
      cmp.form.startTls = true;
      cmp.onStartTls();

      expect(cmp.form.ssl).toBe(false);
      expect(cmp.form.port).toBe(389);
    });

    it('désactiver STARTTLS ne modifie rien', () => {
      const cmp = build();
      cmp.form.ssl = true;
      cmp.form.port = 636;
      cmp.form.startTls = false;
      cmp.onStartTls();

      expect(cmp.form.ssl).toBe(true);
      expect(cmp.form.port).toBe(636);
    });
  });

  // ─── save() ───────────────────────────────────────────────────────────────

  it('save() envoie le formulaire et notifie le succès', () => {
    const cmp = build();
    cmp.form.host = 'ldap2';
    cmp.save();

    expect(api.updateLdapSettings.mock.calls[0][0]).toMatchObject({ host: 'ldap2' });
    expect(cmp.busy()).toBe(false);
    expect(toast.success).toHaveBeenCalledWith('Enregistré', 'Paramètres LDAP mis à jour.');
  });

  it('save() omet le mot de passe de liaison quand il est vide', () => {
    const cmp = build();
    cmp.bindPassword = '  ';
    cmp.save();
    expect(api.updateLdapSettings.mock.calls[0][0]).not.toHaveProperty('bindPassword');
  });

  it('save() transmet le mot de passe de liaison puis l’efface', () => {
    const cmp = build();
    cmp.bindPassword = 'secret';
    cmp.save();
    expect(api.updateLdapSettings.mock.calls[0][0]).toMatchObject({ bindPassword: 'secret' });
    expect(cmp.bindPassword).toBe('');
  });

  it('save() retombe sur le port 389 quand le port est invalide', () => {
    const cmp = build();
    cmp.form.port = '' as unknown as number;
    cmp.save();
    expect(api.updateLdapSettings.mock.calls[0][0]).toMatchObject({ port: 389 });
  });

  it('save() en échec libère busy et notifie', () => {
    const cmp = build();
    api.updateLdapSettings.mockReturnValue(throwError(() => new Error('ko')));
    cmp.save();
    expect(cmp.busy()).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Erreur', 'Enregistrement impossible.');
  });

  // ─── testConn() ───────────────────────────────────────────────────────────

  it('testConn() réussi expose le message et notifie', () => {
    const cmp = build();
    cmp.testConn();

    expect(cmp.busy()).toBe(false);
    expect(cmp.testOk()).toBe(true);
    expect(cmp.testMsg()).toBe('Liaison OK');
    expect(toast.success).toHaveBeenCalledWith('Connexion LDAP', "Liaison à l'annuaire réussie.");
  });

  it('testConn() en échec logique expose le détail renvoyé', () => {
    const cmp = build();
    api.testLdapSettings.mockReturnValue(of({ ok: false, message: 'Bind refusé' }));
    cmp.testConn();

    expect(cmp.testOk()).toBe(false);
    expect(cmp.testMsg()).toBe('Bind refusé');
    expect(toast.error).toHaveBeenCalledWith('Échec LDAP', 'La connexion a échoué (voir le détail).');
  });

  it('testConn() en erreur réseau bascule en « Test impossible »', () => {
    const cmp = build();
    api.testLdapSettings.mockReturnValue(throwError(() => new Error('down')));
    cmp.testConn();

    expect(cmp.busy()).toBe(false);
    expect(cmp.testOk()).toBe(false);
    expect(cmp.testMsg()).toBe('Test impossible.');
    expect(toast.error).toHaveBeenCalledWith('Erreur', 'Test impossible.');
  });

  it('testConn() efface le message précédent avant de relancer', () => {
    const cmp = build();
    api.testLdapSettings.mockReturnValue(of({ ok: false, message: 'Erreur 1' }));
    cmp.testConn();
    expect(cmp.testMsg()).toBe('Erreur 1');

    // Un test qui n'émet jamais laisse le message vidé pendant l'attente.
    api.testLdapSettings.mockReturnValue(of());
    cmp.testConn();
    expect(cmp.testMsg()).toBe('');
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
      expect(el.querySelector('.card-body')).not.toBeNull();
      expect(el.textContent).toContain('Annuaire LDAP');
    });

    it('le badge reflète l’état d’activation', () => {
      expect(render(of(ldapSettings({ enabled: true }))).el.querySelector('.badge')!.textContent!.trim())
        .toBe('Activé');
      expect(render(of(ldapSettings({ enabled: false }))).el.querySelector('.badge')!.textContent!.trim())
        .toBe('Désactivé');
    });

    it('signale un mot de passe de service déjà défini', () => {
      const { el } = render(of(ldapSettings({ bindPasswordSet: true })));
      expect(el.textContent).toContain('● défini');
      expect(el.querySelector<HTMLInputElement>('input[name="bindPassword"]')!.placeholder)
        .toContain('laisser vide = inchangé');
    });

    it('sans mot de passe de service, l’indicateur est absent', () => {
      const { el } = render(of(ldapSettings({ bindPasswordSet: false })));
      expect(el.textContent).not.toContain('● défini');
      expect(el.querySelector<HTMLInputElement>('input[name="bindPassword"]')!.placeholder)
        .toBe('mot de passe du compte de bind');
    });

    it('aucun panneau de résultat tant qu’aucun test n’a été lancé', () => {
      const { el } = render();
      expect(el.textContent).not.toContain('✓ ');
      expect(el.textContent).not.toContain('✕ ');
    });

    it('un test réussi affiche un panneau de succès', () => {
      const { fixture, el } = render();
      bouton(el, '🔌 Tester la connexion').click();
      fixture.detectChanges();

      expect(el.textContent).toContain('✓ Liaison OK');
      expect(el.querySelector('.bg-emerald-50')).not.toBeNull();
    });

    it('un test en échec affiche un panneau d’erreur', () => {
      const { fixture, el } = render();
      api.testLdapSettings.mockReturnValue(of({ ok: false, message: 'Bind refusé' }));
      bouton(el, '🔌 Tester la connexion').click();
      fixture.detectChanges();

      expect(el.textContent).toContain('✕ Bind refusé');
      expect(el.querySelector('.bg-red-50')).not.toBeNull();
    });

    it('les boutons changent de libellé et se désactivent pendant un traitement', () => {
      const { fixture, cmp, el } = render();
      expect(bouton(el, 'Enregistrer').disabled).toBe(false);

      api.updateLdapSettings.mockReturnValue(new Subject());
      cmp.save();
      fixture.detectChanges();

      expect(cmp.busy()).toBe(true);
      expect(bouton(el, 'Enregistrement…').disabled).toBe(true);
      expect(bouton(el, '…').disabled).toBe(true);
    });

    it('un clic sur Enregistrer déclenche la sauvegarde', () => {
      const { el } = render();
      bouton(el, 'Enregistrer').click();
      expect(api.updateLdapSettings).toHaveBeenCalledOnce();
    });

    it('cocher SSL depuis le gabarit bascule le port et décoche STARTTLS', async () => {
      const { fixture, cmp, el } = render(of(ldapSettings({ ssl: false, startTls: true, port: 389 })));
      const ssl = el.querySelector<HTMLInputElement>('input[name="ssl"]')!;

      ssl.checked = true;
      ssl.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      fixture.detectChanges();

      expect(cmp.form.ssl).toBe(true);
      expect(cmp.form.startTls).toBe(false);
      expect(cmp.form.port).toBe(636);
    });
  });
});
