import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, NavigationEnd, provideRouter } from '@angular/router';
import { provideLocationMocks } from '@angular/common/testing';
import { Subject, of, throwError } from 'rxjs';
import { PublicLayout, ClientLayout, BackofficeLayout } from './layouts';
import { MockData } from '../services/mock-data';
import { AuthService } from '../services/auth-service';
import { ApiService } from '../services/api';
import { IdleService } from '../services/idle';
import { Notification, Permission, UserRole } from '../models/models';

function notif(over: Partial<Notification> = {}): Notification {
  return {
    id: 'n1', type: 'INFO', titre: 'Titre', message: 'Msg',
    date: '2026-07-09 10:00', lu: false, canal: ['IN_APP'], ...over,
  } as Notification;
}

let routerEvents: Subject<any>;
let navigate: ReturnType<typeof vi.fn>;
let idle: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
let data: any;
let api: any;
let auth: any;

function baseData(opts: {
  notifications?: Notification[];
  permissions?: Permission[];
  role?: UserRole;
} = {}) {
  return {
    notifications: signal<Notification[]>(opts.notifications ?? []),
    currentUser: signal({ nom: 'Doe', prenom: 'John', role: opts.role ?? 'CLIENT_PP' }),
    hasPermission: vi.fn((p: Permission) => (opts.permissions ?? []).includes(p)),
    refreshNotifications: vi.fn(),
    markAllNotificationsRead: vi.fn(),
    markNotificationRead: vi.fn(),
    refreshPermissions: vi.fn(),
  };
}

function configure(dataDouble: any, extra: any[] = []) {
  TestBed.resetTestingModule();
  routerEvents = new Subject();
  navigate = vi.fn(() => Promise.resolve(true));
  idle = { start: vi.fn(), stop: vi.fn() };
  auth = { logout: vi.fn(() => of(void 0)) };
  api = { listPendingCoSignatures: vi.fn(() => of([])) };
  data = dataDouble;

  TestBed.configureTestingModule({
    providers: [
      { provide: Router, useValue: { events: routerEvents.asObservable(), navigate } },
      { provide: MockData, useValue: data },
      { provide: AuthService, useValue: auth },
      { provide: ApiService, useValue: api },
      { provide: IdleService, useValue: idle },
      ...extra,
    ],
  });
}

/** Émet une fin de navigation sur le Router factice. */
function naviguer() {
  routerEvents.next(new NavigationEnd(1, '/a', '/a'));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ═══════════════════════════════ ClientLayout ═══════════════════════════════

describe('ClientLayout', () => {
  function build(opts: Parameters<typeof baseData>[0] = {}) {
    configure(baseData(opts));
    return TestBed.runInInjectionContext(() => new ClientLayout());
  }

  it('démarre la surveillance d’inactivité et le compteur de co-signatures', () => {
    build();
    expect(idle.start).toHaveBeenCalledOnce();
    expect(api.listPendingCoSignatures).toHaveBeenCalledOnce();
  });

  it('compte les notifications non lues', () => {
    const cmp = build({ notifications: [notif({ lu: false }), notif({ id: 'n2', lu: true })] });
    expect(cmp.unread()).toBe(1);
  });

  it('recentNotifs se limite à six entrées', () => {
    const list = Array.from({ length: 9 }, (_, i) => notif({ id: `n${i}` }));
    expect(build({ notifications: list }).recentNotifs()).toHaveLength(6);
  });

  it('initials() concatène les initiales', () => {
    expect(build().initials()).toBe('JD');
  });

  it('initials() tolère un nom ou prénom absent', () => {
    configure({ ...baseData(), currentUser: signal({ nom: '', prenom: '' }) });
    const cmp = TestBed.runInInjectionContext(() => new ClientLayout());
    expect(cmp.initials()).toBe('');
  });

  it('toggleNotif() ouvre le panneau et rafraîchit, referme sans rafraîchir', () => {
    const cmp = build();
    const ev = { stopPropagation: vi.fn() } as unknown as Event;

    cmp.toggleNotif(ev);
    expect(ev.stopPropagation).toHaveBeenCalled();
    expect(cmp.notifOpen()).toBe(true);
    expect(data.refreshNotifications).toHaveBeenCalledOnce();

    cmp.toggleNotif(ev);
    expect(cmp.notifOpen()).toBe(false);
    expect(data.refreshNotifications).toHaveBeenCalledOnce(); // pas de 2e appel
  });

  it('toggleProfile() bascule le profil et ferme les notifications', () => {
    const cmp = build();
    const ev = { stopPropagation: vi.fn() } as unknown as Event;
    cmp.notifOpen.set(true);

    cmp.toggleProfile(ev);
    expect(cmp.profileOpen()).toBe(true);
    expect(cmp.notifOpen()).toBe(false);

    cmp.toggleProfile(ev);
    expect(cmp.profileOpen()).toBe(false);
  });

  it('markAllReadFromBell() marque tout comme lu', () => {
    const cmp = build();
    const ev = { stopPropagation: vi.fn() } as unknown as Event;
    cmp.markAllReadFromBell(ev);
    expect(ev.stopPropagation).toHaveBeenCalled();
    expect(data.markAllNotificationsRead).toHaveBeenCalledOnce();
  });

  it('openNotif() marque une notification non lue puis navigue', () => {
    const cmp = build();
    cmp.notifOpen.set(true);
    cmp.openNotif({ id: 'n1', lu: false });

    expect(data.markNotificationRead).toHaveBeenCalledWith('n1');
    expect(cmp.notifOpen()).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/client/notifications']);
  });

  it('openNotif() ne remarque pas une notification déjà lue', () => {
    const cmp = build();
    cmp.openNotif({ id: 'n1', lu: true });
    expect(data.markNotificationRead).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalled();
  });

  it.each([
    ['INFO', 'ℹ️'], ['SUCCESS', '✅'], ['WARN', '⚠️'], ['ERROR', '❌'], ['INCONNU', '🔔'],
  ])('notifIcon(%s) = %s', (type, icone) => {
    expect(build().notifIcon(type)).toBe(icone);
  });

  it('rel() délègue au formatage relatif', () => {
    expect(typeof build().rel('2026-07-09 10:00')).toBe('string');
  });

  it('close() referme le menu latéral', () => {
    const cmp = build();
    cmp.sidebarOpen.set(true);
    cmp.close();
    expect(cmp.sidebarOpen()).toBe(false);
  });

  it('une navigation referme le menu et rafraîchit les co-signatures', () => {
    const cmp = build();
    cmp.sidebarOpen.set(true);
    api.listPendingCoSignatures.mockClear();

    naviguer();
    expect(cmp.sidebarOpen()).toBe(false);
    expect(api.listPendingCoSignatures).toHaveBeenCalledOnce();
  });

  it('le compteur de co-signatures reflète la liste renvoyée', () => {
    configure(baseData());
    api.listPendingCoSignatures.mockReturnValue(of([{ id: 'a' }, { id: 'b' }]));
    const cmp = TestBed.runInInjectionContext(() => new ClientLayout());
    expect(cmp.cosignCount()).toBe(2);
  });

  it('une liste de co-signatures nulle donne un compteur à 0', () => {
    configure(baseData());
    api.listPendingCoSignatures.mockReturnValue(of(null));
    const cmp = TestBed.runInInjectionContext(() => new ClientLayout());
    expect(cmp.cosignCount()).toBe(0);
  });

  it('une erreur de co-signature laisse le badge inchangé', () => {
    configure(baseData());
    api.listPendingCoSignatures.mockReturnValue(throwError(() => new Error('down')));
    const cmp = TestBed.runInInjectionContext(() => new ClientLayout());
    expect(cmp.cosignCount()).toBe(0);
  });

  it('les co-signatures sont sondées toutes les 45 s', () => {
    build();
    api.listPendingCoSignatures.mockClear();
    vi.advanceTimersByTime(45_000);
    expect(api.listPendingCoSignatures).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(90_000);
    expect(api.listPendingCoSignatures).toHaveBeenCalledTimes(3);
  });

  it('logout() ferme la session puis revient à la connexion', () => {
    build().logout();
    expect(auth.logout).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(['/auth/login']);
  });

  it('ngOnDestroy() arrête le sondage et la surveillance d’inactivité', () => {
    const cmp = build();
    cmp.ngOnDestroy();
    expect(idle.stop).toHaveBeenCalledOnce();

    api.listPendingCoSignatures.mockClear();
    vi.advanceTimersByTime(180_000);
    expect(api.listPendingCoSignatures).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════ BackofficeLayout ═════════════════════════════

describe('BackofficeLayout', () => {
  function build(opts: Parameters<typeof baseData>[0] = {}) {
    configure(baseData({ role: 'AGENT', ...opts }));
    return TestBed.runInInjectionContext(() => new BackofficeLayout());
  }

  it('démarre les permissions et l’inactivité', () => {
    build();
    expect(data.refreshPermissions).toHaveBeenCalledOnce();
    expect(idle.start).toHaveBeenCalledOnce();
  });

  it('canAudit suit la permission AUDIT_READ', () => {
    expect(build({ permissions: [] }).canAudit()).toBe(false);
    expect(build({ permissions: ['AUDIT_READ'] }).canAudit()).toBe(true);
  });

  it('canOps est vrai avec l’une ou l’autre permission d’ordre', () => {
    expect(build({ permissions: ['ORDER_VALIDATE'] }).canOps()).toBe(true);
    expect(build({ permissions: ['ORDER_RESULT_VALIDATE'] }).canOps()).toBe(true);
    expect(build({ permissions: [] }).canOps()).toBe(false);
  });

  it('canManageClients suit la permission CLIENT_MANAGE', () => {
    expect(build({ permissions: ['CLIENT_MANAGE'] }).canManageClients()).toBe(true);
    expect(build({ permissions: [] }).canManageClients()).toBe(false);
  });

  it('isAdmin n’est vrai que pour le rôle ADMIN', () => {
    expect(build({ role: 'ADMIN' }).isAdmin()).toBe(true);
    expect(build({ role: 'SUPERVISEUR' }).isAdmin()).toBe(false);
  });

  it.each<[UserRole, string]>([
    ['AGENT', 'Espace Agent'],
    ['SUPERVISEUR', 'Espace Superviseur'],
    ['ADMIN', 'Espace Administrateur'],
  ])('roleLabel pour %s = %s', (role, libelle) => {
    expect(build({ role }).roleLabel()).toBe(libelle);
  });

  it('roleLabel retombe sur « Back-Office » pour un rôle inconnu', () => {
    expect(build({ role: 'CLIENT_PP' }).roleLabel()).toBe('Back-Office');
  });

  it('initials() concatène les initiales', () => {
    expect(build().initials()).toBe('JD');
  });

  it('close() referme le menu latéral', () => {
    const cmp = build();
    cmp.sidebarOpen.set(true);
    cmp.close();
    expect(cmp.sidebarOpen()).toBe(false);
  });

  it('une navigation referme le menu et rafraîchit les permissions', () => {
    const cmp = build();
    cmp.sidebarOpen.set(true);
    data.refreshPermissions.mockClear();

    naviguer();
    expect(cmp.sidebarOpen()).toBe(false);
    expect(data.refreshPermissions).toHaveBeenCalledOnce();
  });

  it('les permissions sont resondées toutes les 2 minutes', () => {
    build();
    data.refreshPermissions.mockClear();
    vi.advanceTimersByTime(120_000);
    expect(data.refreshPermissions).toHaveBeenCalledOnce();
  });

  it('logout() ferme la session puis revient à la connexion', () => {
    build().logout();
    expect(auth.logout).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(['/auth/login']);
  });

  it('ngOnDestroy() arrête le sondage des permissions et l’inactivité', () => {
    const cmp = build();
    cmp.ngOnDestroy();
    expect(idle.stop).toHaveBeenCalledOnce();

    data.refreshPermissions.mockClear();
    vi.advanceTimersByTime(300_000);
    expect(data.refreshPermissions).not.toHaveBeenCalled();
  });
});

// ════════════ Rendu des gabarits (couverture des lignes de template) ════════════
// Les tests ci-dessus exercent les méthodes/computed sans jamais rendre le DOM.
// Ces layouts ont un `template:` inline volumineux : on rend donc chaque layout
// avec un vrai Router (nécessaire pour RouterLink/RouterLinkActive/RouterOutlet)
// et on pilote chaque branche (@if permissions, badges, panneaux) en affirmant
// ce que le DOM affiche.

/** Config de rendu : vrai Router + doubles de services (idle enrichi de signaux). */
function renderConfigure(dataDouble: any) {
  TestBed.resetTestingModule();
  idle = {
    start: vi.fn(), stop: vi.fn(),
    warningActive: signal(false), secondsLeft: signal(30), continueSession: vi.fn(),
  } as any;
  auth = { logout: vi.fn(() => of(void 0)) };
  api = { listPendingCoSignatures: vi.fn(() => of([])) };
  data = dataDouble;

  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideLocationMocks(),
      { provide: MockData, useValue: data },
      { provide: AuthService, useValue: auth },
      { provide: ApiService, useValue: api },
      { provide: IdleService, useValue: idle },
    ],
  });
}

function renderCmp<T>(ctor: new () => T) {
  const fixture = TestBed.createComponent(ctor);
  fixture.detectChanges();
  return fixture;
}

const el = (f: any) => f.nativeElement as HTMLElement;
const txt = (f: any) => el(f).textContent ?? '';

/** Double de MockData « client » avec un utilisateur complet (téléphone, compte). */
function richClientData(over: { notifications?: Notification[]; user?: any } = {}) {
  return {
    notifications: signal<Notification[]>(over.notifications ?? []),
    currentUser: signal<any>(
      over.user ?? { nom: 'Doe', prenom: 'John', email: 'j@d.cm', telephone: '690000000', compteTitres: 'CT-123' },
    ),
    hasPermission: vi.fn(() => false),
    refreshNotifications: vi.fn(),
    markAllNotificationsRead: vi.fn(),
    markNotificationRead: vi.fn(),
    refreshPermissions: vi.fn(),
  };
}

describe('PublicLayout (rendu)', () => {
  it('rend l’en-tête, la navigation et le pied de page', () => {
    renderConfigure(baseData());
    const f = renderCmp(PublicLayout);
    expect(txt(f)).toContain('Afriland First Bond');
    expect(txt(f)).toContain('Portail Valeurs du Trésor CEMAC');
    expect(txt(f)).toContain('Se connecter');
    expect(el(f).querySelectorAll('a[href="/emissions"]').length).toBeGreaterThan(0);
    expect(el(f).querySelector('footer')?.textContent).toContain('2026');
  });
});

describe('ClientLayout (rendu)', () => {
  /** Utilisateur d'un compte à plusieurs signataires : le menu « Validations » s'ajoute. */
  const userCompteJoint = {
    nom: 'Doe', prenom: 'John', email: 'j@d.cm', telephone: '690000000',
    compteTitres: 'CT-123', compteJoint: true,
  };

  it('rend la barre latérale (7 liens) et l’en-tête utilisateur', () => {
    renderConfigure(richClientData({
      notifications: [notif({ lu: false }), notif({ id: 'n2', lu: false }), notif({ id: 'n3', lu: true })],
      user: userCompteJoint,
    }));
    const f = renderCmp(ClientLayout);
    expect(el(f).querySelectorAll('aside nav a').length).toBe(7);
    expect(txt(f)).toContain('John Doe');
    expect(txt(f)).toContain('690000000'); // branche @if(user().telephone)
    expect(txt(f)).toContain('CT-123');
    const badge = el(f).querySelector('[aria-label="Notifications"] span');
    expect(badge?.textContent?.trim()).toBe('2'); // non lus
  });

  it('masque le menu « Validations » pour un compte individuel', () => {
    renderConfigure(richClientData()); // compteJoint absent → faux
    const f = renderCmp(ClientLayout);
    expect(el(f).querySelectorAll('aside nav a').length).toBe(6);
    expect(txt(f)).not.toContain('Validations');
  });

  it('affiche le menu « Validations » dès que le compte est joint', () => {
    renderConfigure(richClientData({ user: userCompteJoint }));
    const f = renderCmp(ClientLayout);
    expect(txt(f)).toContain('Validations');
  });

  it('le panneau de notifications liste les entrées', () => {
    renderConfigure(richClientData({
      notifications: [
        notif({ id: 'a', lu: false, type: 'SUCCESS', titre: 'Ordre validé' }),
        notif({ id: 'b', lu: true, type: 'INFO', titre: 'Information' }),
      ],
    }));
    const f = renderCmp(ClientLayout);
    f.componentInstance.notifOpen.set(true);
    f.detectChanges();
    expect(txt(f)).toContain('Tout marquer lu'); // unread > 0
    expect(txt(f)).toContain('Ordre validé');
    expect(txt(f)).toContain('✅'); // notifIcon(SUCCESS)
    expect(el(f).querySelectorAll('button.text-left').length).toBe(2);
    expect(txt(f)).toContain('Voir toutes les notifications');
  });

  it('panneau vide : affiche « Aucune notification » et aucun badge', () => {
    renderConfigure(richClientData({ notifications: [] }));
    const f = renderCmp(ClientLayout);
    f.componentInstance.notifOpen.set(true);
    f.detectChanges();
    expect(txt(f)).toContain('Aucune notification');
    expect(txt(f)).not.toContain('Tout marquer lu');
    expect(el(f).querySelector('[aria-label="Notifications"] span')).toBeNull();
  });

  it('le menu profil montre le compte et la déconnexion', () => {
    renderConfigure(richClientData());
    const f = renderCmp(ClientLayout);
    f.componentInstance.profileOpen.set(true);
    f.detectChanges();
    expect(txt(f)).toContain('Mon compte');
    expect(txt(f)).toContain('Se déconnecter');
    expect(txt(f)).toContain('j@d.cm');
    expect(txt(f)).toContain('CT-123');
  });

  it('la modale d’inactivité affiche le compte à rebours', () => {
    renderConfigure(richClientData());
    const f = renderCmp(ClientLayout);
    (idle as any).warningActive.set(true);
    (idle as any).secondsLeft.set(42);
    f.detectChanges();
    expect(txt(f)).toContain('Session inactive');
    expect(txt(f)).toContain('42s');
  });

  it('le badge de la cloche affiche « 9+ » au-delà de neuf non lus', () => {
    const many = Array.from({ length: 12 }, (_, i) => notif({ id: 'x' + i, lu: false }));
    renderConfigure(richClientData({ notifications: many }));
    const f = renderCmp(ClientLayout);
    expect(el(f).querySelector('[aria-label="Notifications"] span')?.textContent?.trim()).toBe('9+');
  });

  it('menu latéral ouvert : superpose l’écran et affiche le badge de co-signatures', () => {
    renderConfigure(richClientData({ user: userCompteJoint }));
    api.listPendingCoSignatures.mockReturnValue(of([{ id: 'a' }, { id: 'b' }, { id: 'c' }]));
    const f = renderCmp(ClientLayout);
    f.componentInstance.sidebarOpen.set(true);
    f.detectChanges();
    const overlays = Array.from(el(f).querySelectorAll('div')).filter((d) => d.className.includes('bg-black/50'));
    expect(overlays.length).toBe(1);
    const valLink = Array.from(el(f).querySelectorAll('aside nav a')).find((a) => a.textContent?.includes('Validations'))!;
    expect(valLink.querySelector('span.bg-afb-red')?.textContent?.trim()).toBe('3');
  });
});

describe('BackofficeLayout (rendu)', () => {
  it('un administrateur voit toutes les sections du menu', () => {
    renderConfigure(baseData({
      role: 'ADMIN',
      permissions: ['ORDER_VALIDATE', 'CLIENT_MANAGE', 'ACCOUNT_BALANCE_READ', 'AUDIT_READ'],
    }));
    const t = txt(renderCmp(BackofficeLayout));
    expect(t).toContain('Espace Administrateur');
    expect(t).toContain('Ordres collectés');
    expect(t).toContain('Livrables');
    expect(t).toContain('Clients');
    expect(t).toContain('Import portefeuille');
    expect(t).toContain('Administration');
    expect(t).toContain('Utilisateurs');
    expect(t).toContain('Messagerie');
    expect(t).toContain('Serveur OTP');
    expect(t).toContain('LDAP');
    expect(t).toContain("Journal d'audit");
  });

  it('un agent sans permission voit un menu réduit', () => {
    renderConfigure(baseData({ role: 'AGENT', permissions: [] }));
    const t = txt(renderCmp(BackofficeLayout));
    expect(t).toContain('Espace Agent');
    expect(t).toContain('Codes OTP');
    expect(t).toContain('Lien de connexion');
    expect(t).not.toContain('Ordres collectés');
    expect(t).not.toContain('Clients');
    expect(t).not.toContain('Consultation de solde');
    expect(t).not.toContain('Administration');
    expect(t).not.toContain("Journal d'audit");
  });

  it('les opérations apparaissent avec ORDER_VALIDATE mais pas la gestion clients', () => {
    renderConfigure(baseData({ role: 'AGENT', permissions: ['ORDER_VALIDATE'] }));
    const t = txt(renderCmp(BackofficeLayout));
    expect(t).toContain('Ordres collectés');
    expect(t).toContain('Livrables');
    expect(t).not.toContain('Clients');
  });

  it('l’auditeur non-admin voit le journal sans les outils d’administration', () => {
    renderConfigure(baseData({ role: 'SUPERVISEUR', permissions: ['AUDIT_READ'] }));
    const t = txt(renderCmp(BackofficeLayout));
    expect(t).toContain('Espace Superviseur');
    expect(t).toContain('Administration');
    expect(t).toContain("Journal d'audit");
    expect(t).not.toContain('Utilisateurs');
  });

  it('la modale d’inactivité et le bouton de déconnexion sont rendus', () => {
    renderConfigure(baseData({ role: 'ADMIN' }));
    const f = renderCmp(BackofficeLayout);
    (idle as any).warningActive.set(true);
    (idle as any).secondsLeft.set(15);
    f.detectChanges();
    expect(txt(f)).toContain('Session inactive');
    expect(txt(f)).toContain('15s');
    const logout = Array.from(el(f).querySelectorAll('aside button')).find((b) => b.textContent?.trim() === 'Se déconnecter');
    expect(logout).toBeTruthy();
  });
});
