import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, Type } from '@angular/core';
import { of, throwError } from 'rxjs';
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { Portfolio, Notifications, Profile } from './client-pages2';
import { MockData } from '../../core/services/mock-data';
import { ToastService } from '../../core/services/toast';
import { Notification, Position } from '../../core/models/models';

// `DecimalPipe` formate en fr-FR : la locale est enregistrée par app.config.ts,
// que le TestBed ne charge pas. Sans cela : NG0701 « Missing locale data ».
registerLocaleData(localeFr, 'fr-FR');

function position(over: Partial<Position> = {}): Position {
  return {
    isin: 'CM0000000001', emissionCode: 'BTA-CMR-26-01', nature: 'BTA', emetteur: 'Cameroun',
    volume: 10, valeurNominale: 10000, valeurTotale: 100000, dateEcheance: '2026-07-01', ...over,
  } as Position;
}

function notif(over: Partial<Notification> = {}): Notification {
  return {
    id: 'n1', type: 'INFO', titre: 'Titre', message: 'Msg', date: '2026-07-09 10:00',
    lu: false, canal: ['IN_APP'], ...over,
  } as Notification;
}

let data: any, toast: any;
let positions: ReturnType<typeof signal<Position[]>>;
let notifications: ReturnType<typeof signal<Notification[]>>;

function makeFakes() {
  positions = signal<Position[]>([]);
  notifications = signal<Notification[]>([]);
  data = {
    currentUser: signal<any>({
      id: 'u1', nom: 'Doe', prenom: 'John', email: 'j@d.cm', compteTitres: 'CT1',
      compte: {
        id: 'c1', numero: 'CT1', typeCompte: 'INDIVIDUEL', statut: 'ACTIF', dateOuverture: '2025-01-01',
        categorie: 'QUALIFIE', compteEspecesLie: 'CE1', soldeEspeces: 0,
        adresses: [], contacts: [{ civilite: 'M.', telephonePortable: '690' }], sousComptes: [],
      },
    }),
    positions,
    notifications,
    refreshPositions: vi.fn(),
    refreshMyCompte: vi.fn(),
    generateAttestation: vi.fn(() => of({ id: 'd1', reference: 'DOC-20260714-000001' })),
    markAllNotificationsRead: vi.fn(),
    markNotificationRead: vi.fn(),
  };
  toast = { success: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function configure() {
  makeFakes();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [Portfolio, Notifications, Profile],
    providers: [
      { provide: MockData, useValue: data },
      { provide: ToastService, useValue: toast },
    ],
  });
}

function create<T>(type: Type<T>): T {
  return TestBed.createComponent(type).componentInstance;
}

function render<T>(type: Type<T>) {
  const fixture = TestBed.createComponent(type);
  fixture.detectChanges();
  return fixture;
}

/** Force un cycle de détection après mutation d'un champ non-signal (évite NG0100). */
function refresh(fixture: { componentRef: any; detectChanges: () => void }) {
  fixture.componentRef.changeDetectorRef.markForCheck();
  fixture.detectChanges();
}

const txt = (el: Element | null) => (el?.textContent ?? '').trim();

function richUser() {
  return {
    id: 'u1', nom: 'Doe', prenom: 'John', email: 'j@d.cm', compteTitres: 'CT1',
    compte: {
      id: 'c1', numero: 'CT1', typeCompte: 'INDIVIDUEL', statut: 'ACTIF', dateOuverture: '2025-01-01',
      categorie: 'NON_QUALIFIE', compteEspecesLie: 'CE1', soldeEspeces: 0,
      adresses: [
        { type: 'FISCALE', residence: 'Résidence A', rue: '1 rue de la Bourse', codePostal: '00237', ville: 'Yaoundé', pays: 'Cameroun' },
        { type: 'POSTALE', rue: 'BP 2', ville: 'Douala', pays: 'Cameroun' },
      ],
      contacts: [
        { id: 'k1', type: 'TITULAIRE', nom: 'Doe', prenom: 'John', civilite: 'M.', fonction: 'DG', telephonePortable: '690000000', telephoneDomicile: '222000000', telephoneBureau: '233000000', email: 'j@d.cm', whatsapp: '690000000', pieceIdentite: 'CNI', numeroPiece: '123', dateValiditePiece: '2030-01-01' },
        { id: 'k2', type: 'URGENCE', nom: 'Kin', prenom: 'Ada', lienParente: 'Sœur' },
      ],
      sousComptes: [
        { id: 's1', numero: 'SC1', libelle: 'Conservation', type: 'CONSERVATION', statut: 'ACTIF', dateOuverture: '2025-02-01', positionsCount: 2, valeurTotale: 1000, observations: 'Observation libre' },
        { id: 's2', numero: 'SC2', libelle: 'Gage', type: 'GAGE', statut: 'BLOQUE', dateOuverture: '2025-03-01', positionsCount: 0, valeurTotale: 0 },
      ],
    },
  };
}

beforeEach(() => configure());

// ─── Portfolio ───────────────────────────────────────────────────────────────

describe('Portfolio', () => {
  it('recharge les positions au montage', () => {
    create(Portfolio);
    expect(data.refreshPositions).toHaveBeenCalled();
  });

  it('somme la valeur totale et le prochain flux', () => {
    positions.set([
      position({ valeurTotale: 100, prochainFlux: { montant: 5, type: 'COUPON', date: '2026-08-01' } as any }),
      position({ valeurTotale: 250, prochainFlux: { montant: 7, type: 'COUPON', date: '2026-08-01' } as any }),
      position({ valeurTotale: 50 }),
    ]);
    const c = create(Portfolio);
    expect(c.total()).toBe(400);
    expect(c.prochain()).toBe(12);
  });

  it('askGenerate ouvre le dialogue OTP', () => {
    const c = create(Portfolio);
    expect(c.otpOpen()).toBe(false);
    c.askGenerate();
    expect(c.otpOpen()).toBe(true);
  });

  it("doGenerate fait éditer l'attestation par le serveur et notifie le succès", () => {
    positions.set([position()]);
    const c = create(Portfolio);
    c.otpOpen.set(true);
    c.doGenerate();
    expect(c.otpOpen()).toBe(false);
    // Aucun contenu n'est transmis : le PDF est produit en base côté serveur.
    expect(data.generateAttestation).toHaveBeenCalledWith();
    expect(toast.success).toHaveBeenCalledWith(
      'Attestation générée', expect.stringContaining('DOC-20260714-000001'));
    expect(c.generating()).toBe(false);
  });

  it('doGenerate remonte le refus du serveur (aucune position en portefeuille)', () => {
    data.generateAttestation = vi.fn(() => throwError(() => ({
      error: { message: "Aucune position en portefeuille : l'attestation de propriété est sans objet." },
    })));
    const c = create(Portfolio);
    c.doGenerate();
    expect(toast.error).toHaveBeenCalledWith(
      'Génération impossible', expect.stringContaining('Aucune position'));
    expect(c.generating()).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('rend le tableau des positions avec natures BTA et OTA et le prochain flux', () => {
    positions.set([
      position({ isin: 'CM01', nature: 'BTA', prochainFlux: { montant: 500, type: 'COUPON', date: '2026-08-01' } as any }),
      position({ isin: 'CM02', nature: 'OTA', sousCompteId: 'sc2' }),
    ]);
    const f = render(Portfolio);
    const html = f.nativeElement.textContent;
    expect(html).toContain('CM01');
    expect(html).toContain('CM02');
    expect(html).toContain('BTA');
    expect(html).toContain('OTA');
    // badge BTA -> bleu, OTA -> violet
    const badges = f.nativeElement.querySelectorAll('td .badge');
    expect(badges[0].classList.contains('bg-blue-100')).toBe(true);
    expect(badges[1].classList.contains('bg-purple-100')).toBe(true);
  });
});

// ─── Notifications ───────────────────────────────────────────────────────────

describe('Notifications', () => {
  it('compte les notifications non lues', () => {
    notifications.set([notif({ id: 'a', lu: false }), notif({ id: 'b', lu: true }), notif({ id: 'c', lu: false })]);
    const c = create(Notifications);
    expect(c.unread()).toBe(2);
  });

  it('filtre les non lues et remet la pagination à 1', () => {
    notifications.set([notif({ id: 'a', lu: false }), notif({ id: 'b', lu: true })]);
    const c = create(Notifications);
    expect(c.filtered().length).toBe(2);
    c.page.set(3);
    c.setFilter('unread');
    expect(c.page()).toBe(1);
    expect(c.filtered().map((n) => n.id)).toEqual(['a']);
  });

  it('pagine par tranches de dix', () => {
    notifications.set(Array.from({ length: 25 }, (_, i) => notif({ id: 'n' + i })));
    const c = create(Notifications);
    expect(c.totalPages()).toBe(3);
    expect(c.pageItems().length).toBe(10);
    c.page.set(3);
    expect(c.pageItems().length).toBe(5);
  });

  it('markAllRead délègue au service', () => {
    const c = create(Notifications);
    c.markAllRead();
    expect(data.markAllNotificationsRead).toHaveBeenCalled();
  });

  it('markRead ne marque que les non lues et stoppe la propagation', () => {
    const c = create(Notifications);
    const ev = { stopPropagation: vi.fn() } as any;
    c.markRead(notif({ id: 'a', lu: false }), ev);
    expect(ev.stopPropagation).toHaveBeenCalled();
    expect(data.markNotificationRead).toHaveBeenCalledWith('a');
    data.markNotificationRead.mockClear();
    c.markRead(notif({ id: 'b', lu: true }));
    expect(data.markNotificationRead).not.toHaveBeenCalled();
  });

  it('onItemClick marque une notification non lue comme lue', () => {
    const c = create(Notifications);
    c.onItemClick(notif({ id: 'z', lu: false }));
    expect(data.markNotificationRead).toHaveBeenCalledWith('z');
  });

  it('icônes, accents et libellés de canal', () => {
    const c = create(Notifications);
    expect(c.icon('SUCCESS')).toBe('✅');
    expect(c.icon('AUTRE' as any)).toBe('🔔');
    expect(c.accentClass('SUCCESS')).toBe('border-l-emerald-500');
    expect(c.accentClass('AUTRE' as any)).toBe('border-l-gray-300');
    expect(c.iconWrapClass('WARN')).toBe('bg-amber-50');
    expect(c.canalLabel('EMAIL')).toBe('E-mail');
    expect(c.canalLabel('XYZ')).toBe('XYZ');
  });

  it('rel renvoie un horodatage relatif', () => {
    const c = create(Notifications);
    expect(typeof c.rel('2026-07-09 09:00')).toBe('string');
  });

  it('rend la liste avec les quatre types, la pastille non lue et le bouton « Marquer comme lu »', () => {
    notifications.set([
      notif({ id: 'a', type: 'INFO', lu: false, canal: ['EMAIL', 'SMS'] }),
      notif({ id: 'b', type: 'SUCCESS', lu: true, canal: ['WHATSAPP'] }),
      notif({ id: 'c', type: 'WARN', lu: false, canal: ['IN_APP'] }),
      notif({ id: 'd', type: 'ERROR', lu: true, canal: [] }),
    ]);
    const f = render(Notifications);
    const html = f.nativeElement.textContent;
    expect(html).toContain('E-mail');
    expect(html).toContain('WhatsApp');
    // 2 non lues -> 2 pastilles absolues + boutons marquer comme lu
    const readBtns = [...f.nativeElement.querySelectorAll('button')]
      .filter((b: any) => b.textContent?.trim() === 'Marquer comme lu');
    expect(readBtns.length).toBe(2);
    readBtns[0].click();
    expect(data.markNotificationRead).toHaveBeenCalledWith('a');
  });

  it('clic sur une notification non lue la marque comme lue via le template', () => {
    notifications.set([notif({ id: 'clic', lu: false })]);
    const f = render(Notifications);
    f.nativeElement.querySelector('.group').click();
    expect(data.markNotificationRead).toHaveBeenCalledWith('clic');
  });

  it('affiche l’état vide « aucune notification » et sa variante non lue', () => {
    notifications.set([]);
    const f = render(Notifications);
    expect(f.nativeElement.textContent).toContain('Aucune notification pour le moment');
    f.componentInstance.setFilter('unread');
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Aucune notification non lue');
  });

  it('affiche les contrôles de pagination au-delà d’une page', () => {
    notifications.set(Array.from({ length: 25 }, (_, i) => notif({ id: 'n' + i })));
    const f = render(Notifications);
    const c = f.componentInstance;
    expect(f.nativeElement.textContent).toContain('Page 1 / 3');
    const next = [...f.nativeElement.querySelectorAll('button')]
      .find((b: any) => b.textContent?.trim() === 'Suivant ›');
    next.click();
    f.detectChanges();
    expect(c.page()).toBe(2);
    const prev = [...f.nativeElement.querySelectorAll('button')]
      .find((b: any) => b.textContent?.trim() === '‹ Précédent');
    prev.click();
    f.detectChanges();
    expect(c.page()).toBe(1);
  });

  it('le bouton « Tout marquer comme lu » se désactive quand tout est lu', () => {
    notifications.set([notif({ id: 'x', lu: true })]);
    const f = render(Notifications);
    const btn = [...f.nativeElement.querySelectorAll('button')]
      .find((b: any) => b.textContent?.includes('Tout marquer comme lu'));
    expect(btn.disabled).toBe(true);
  });
});

// ─── Profile ─────────────────────────────────────────────────────────────────

describe('Profile', () => {
  it('recharge le compte-titres au montage et expose ct()', () => {
    const c = create(Profile);
    expect(data.refreshMyCompte).toHaveBeenCalled();
    expect(c.ct().numero).toBe('CT1');
  });

  it('bascule d’onglet', () => {
    const c = create(Profile);
    expect(c.tab()).toBe('identity');
    c.tab.set('security');
    expect(c.tab()).toBe('security');
  });

  it('pwdStrong valide la robustesse CSFT §M2-A02', () => {
    const c = create(Profile);
    c.newPwd = 'faible';
    expect(c.pwdStrong()).toBe(false);
    c.newPwd = 'Solide1!';
    expect(c.pwdStrong()).toBe(true);
  });

  it('canChangePwd exige ancien mdp, robustesse, confirmation et changement réel', () => {
    const c = create(Profile);
    c.oldPwd = 'Ancien1!';
    c.newPwd = 'Nouveau1!';
    c.confirmPwd = 'Nouveau1!';
    expect(c.canChangePwd()).toBe(true);
    c.confirmPwd = 'Autre';
    expect(c.canChangePwd()).toBe(false);
    c.confirmPwd = 'Ancien1!';
    c.newPwd = 'Ancien1!';
    expect(c.canChangePwd()).toBe(false); // identique à l'ancien
  });

  it('changePwd notifie le succès et purge les secrets', () => {
    const c = create(Profile);
    c.oldPwd = 'Ancien1!';
    c.newPwd = 'Nouveau1!';
    c.confirmPwd = 'Nouveau1!';
    c.changePwd();
    expect(toast.success).toHaveBeenCalledWith('Mot de passe modifié', expect.any(String));
    expect(c.oldPwd).toBe('');
    expect(c.newPwd).toBe('');
    expect(c.confirmPwd).toBe('');
  });

  it('changePwd ne fait rien si les conditions ne sont pas réunies', () => {
    const c = create(Profile);
    c.changePwd();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('ngOnDestroy efface les secrets', () => {
    const c = create(Profile);
    c.oldPwd = 'x';
    c.ngOnDestroy();
    expect(c.oldPwd).toBe('');
  });
});

// ─── Profile (rendu des onglets) ─────────────────────────────────────────────

describe('Profile (rendu)', () => {
  function renderRich() {
    data.currentUser.set(richUser());
    return render(Profile);
  }

  it('affiche les quatre onglets et l’onglet Identité par défaut', () => {
    const f = renderRich();
    const el = f.nativeElement as HTMLElement;
    // Boutons d'onglets (Identité, Adresses, Sous-comptes, Contacts).
    const tabBtns = [...el.querySelectorAll('.border-b button')];
    expect(tabBtns.length).toBe(4);
    // Identité affichée : nom et e-mail sont liés en [value] sur des inputs
    expect(el.textContent).toContain('Identité du titulaire');
    const values = [...el.querySelectorAll('input')].map((i) => (i as HTMLInputElement).value);
    expect(values).toContain('Doe');
    expect(values).toContain('j@d.cm');
    // compte-titres et catégorie sont, eux, du texte
    expect(el.textContent).toContain('CT1');
    expect(el.textContent).toContain('Investisseur non qualifié');
  });

  it('affiche la catégorie « investisseur qualifié » quand le compte est qualifié', () => {
    const u = richUser();
    u.compte.categorie = 'QUALIFIE';
    data.currentUser.set(u);
    const f = render(Profile);
    expect(f.nativeElement.textContent).toContain('Investisseur qualifié');
  });

  it('onglet Adresses : liste les adresses avec la résidence quand présente', () => {
    const f = renderRich();
    f.componentInstance.tab.set('addresses');
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('FISCALE');
    expect(el.textContent).toContain('POSTALE');
    expect(el.textContent).toContain('Résidence A');
    expect(el.textContent).toContain('1 rue de la Bourse');
    expect(el.textContent).toContain('Yaoundé');
    // 2 cartes d'adresse
    expect(el.querySelectorAll('.card').length).toBe(2);
  });

  it('onglet Sous-comptes : cartes + tableau de synthèse et observations', () => {
    const f = renderRich();
    f.componentInstance.tab.set('subaccounts');
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Conservation');
    expect(el.textContent).toContain('Gage');
    expect(el.textContent).toContain('Observation libre');
    expect(el.textContent).toContain('ACTIF');
    expect(el.textContent).toContain('BLOQUE');
    // Le tableau de synthèse liste les 2 sous-comptes
    expect(el.querySelectorAll('tbody tr').length).toBe(2);
  });

  it('onglet Contacts : types, fonction, lien de parenté et coordonnées', () => {
    const f = renderRich();
    f.componentInstance.tab.set('contacts');
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('TITULAIRE');
    expect(el.textContent).toContain('URGENCE');
    expect(el.textContent).toContain('DG'); // fonction
    expect(el.textContent).toContain('Sœur'); // lien de parenté
    expect(el.textContent).toContain('690000000'); // téléphone portable
    expect(el.textContent).toContain('j@d.cm'); // e-mail contact
  });

  it('onglet Préférences : canaux de notification et documents', () => {
    const f = renderRich();
    f.componentInstance.tab.set('prefs');
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Canaux de notification');
    expect(el.textContent).toContain('WhatsApp Business');
    expect(el.textContent).toContain('Tableaux d\'amortissement OTA');
  });

  it('onglet Sécurité : messages d’erreur mot de passe et bouton désactivé', () => {
    const f = renderRich();
    const c = f.componentInstance;
    c.tab.set('security');
    f.detectChanges();
    // Saisie faible + confirmation divergente
    c.newPwd = 'faible';
    c.confirmPwd = 'autre';
    refresh(f);
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Force insuffisante');
    expect(el.textContent).toContain('Les mots de passe ne correspondent pas');
    // MFA : numéro de portable affiché
    expect(el.textContent).toContain('690000000');
    // Bouton « Modifier le mot de passe » désactivé (canChangePwd faux)
    const btn = [...el.querySelectorAll('button')].find((b) => txt(b) === 'Modifier le mot de passe') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('onglet Sécurité : bouton actif quand la saisie est valide', () => {
    const f = renderRich();
    const c = f.componentInstance;
    c.tab.set('security');
    c.oldPwd = 'Ancien1!';
    c.newPwd = 'Nouveau1!';
    c.confirmPwd = 'Nouveau1!';
    refresh(f);
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('Force insuffisante');
    const btn = [...el.querySelectorAll('button')].find((b) => txt(b) === 'Modifier le mot de passe') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
});
