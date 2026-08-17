import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';

import { BoUsers } from './bo-users';
import { ApiService } from '../../core/services/api';
import { MockData } from '../../core/services/mock-data';
import { AuthService } from '../../core/services/auth-service';
import { ToastService } from '../../core/services/toast';
import { DEFAULT_ROLE_PERMISSIONS } from '../../core/models/models';

// ───────────────────────── Fabriques & doubles ──────────────────────────────

function makeUser(over: Partial<any> = {}): any {
  return { id: 'u-1', nom: 'Dupont', prenom: 'Jean', email: 'jean@x.cm', role: 'AGENT', statut: 'ACTIF', ...over };
}

function makeMockData(opts: { role?: string; permissions?: string[] } = {}) {
  const currentUser = signal<any>({ role: opts.role ?? 'ADMIN' });
  const rolePermissions = signal<any>({ ...DEFAULT_ROLE_PERMISSIONS });
  const perms = opts.permissions ?? [];
  return {
    currentUser,
    rolePermissions,
    hasPermission: vi.fn((p: string) => perms.includes(p)),
    toggleRolePermission: vi.fn(),
  };
}

function makeApi(opts: { users?: any; clients?: any } = {}) {
  return {
    listUsers: vi.fn((): any => opts.users ?? of([makeUser()])),
    listClients: vi.fn((): any => opts.clients ?? of([makeUser({ id: 'c-1', role: 'CLIENT_PP', nom: 'Client', email: 'cli@x.cm' })])),
    createUser: vi.fn((): any => of(makeUser())),
    updateUser: vi.fn((): any => of(makeUser())),
    deleteUser: vi.fn((): any => of({ deleted: true })),
    resetUserPassword: vi.fn((): any => of({ temporaryPassword: 'TempPwd12345' })),
  };
}

function makeAuth() {
  return { errorMessage: vi.fn(() => 'Erreur métier.') };
}

function makeToast() {
  return { success: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('BoUsers', () => {
  let cmp: BoUsers;
  let data: ReturnType<typeof makeMockData>;
  let api: ReturnType<typeof makeApi>;
  let auth: ReturnType<typeof makeAuth>;
  let toast: ReturnType<typeof makeToast>;

  function build(opts: { role?: string; permissions?: string[]; users?: any; clients?: any } = {}) {
    TestBed.resetTestingModule();
    data = makeMockData(opts);
    api = makeApi(opts);
    auth = makeAuth();
    toast = makeToast();
    TestBed.configureTestingModule({
      imports: [BoUsers],
      providers: [
        { provide: MockData, useValue: data },
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: auth },
        { provide: ToastService, useValue: toast },
      ],
    });
    cmp = TestBed.createComponent(BoUsers).componentInstance;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    build();
  });

  it('charge utilisateurs internes et clients à la construction', () => {
    build({ users: of([makeUser(), makeUser({ id: 'u-2' })]), clients: of([makeUser({ id: 'c-1', role: 'CLIENT_PP' })]) });
    expect(cmp.internalUsers()).toHaveLength(2);
    expect(cmp.clients()).toHaveLength(1);
    expect(cmp.accounts()).toHaveLength(3);
  });

  it('vide les listes en cas d’erreur de chargement', () => {
    build({ users: throwError(() => new Error('x')), clients: throwError(() => new Error('y')) });
    expect(cmp.internalUsers()).toEqual([]);
    expect(cmp.clients()).toEqual([]);
  });

  it('randomPassword renvoie un mot de passe de 12 caractères', () => {
    const p = cmp.randomPassword();
    expect(p).toHaveLength(12);
    expect(cmp.randomPassword()).not.toBe(p); // aléatoire
  });

  it('roleLabel traduit les rôles', () => {
    expect(cmp.roleLabel('AGENT')).toBe('Agent SVT');
    expect(cmp.roleLabel('ADMIN')).toBe('Administrateur');
  });

  it('isAdmin et canEditMatrix suivent le rôle courant', () => {
    expect(cmp.isAdmin()).toBe(true);
    expect(cmp.canEditMatrix()).toBe(true);
    build({ role: 'AGENT' });
    expect(cmp.isAdmin()).toBe(false);
    expect(cmp.canEditMatrix()).toBe(false);
  });

  it('canManageUsers reflète la permission USER_MANAGE', () => {
    expect(cmp.canManageUsers()).toBe(false);
    build({ permissions: ['USER_MANAGE'] });
    expect(cmp.canManageUsers()).toBe(true);
  });

  it('assignableRoles dépend du rôle courant', () => {
    build({ role: 'ADMIN' });
    expect(cmp.assignableRoles()).toEqual(['AGENT', 'SUPERVISEUR', 'ADMIN']);
    build({ role: 'SUPERVISEUR' });
    expect(cmp.assignableRoles()).toEqual(['AGENT', 'SUPERVISEUR']);
    build({ role: 'AGENT' });
    expect(cmp.assignableRoles()).toEqual(['AGENT']);
    build({ role: 'CLIENT_PP' });
    expect(cmp.assignableRoles()).toEqual([]);
  });

  it('filtered applique la recherche (nom, prénom, e-mail) et le rôle', () => {
    build({
      users: of([
        makeUser({ id: 'u-1', nom: 'Alpha', prenom: 'Jean', email: 'a@x.cm', role: 'AGENT' }),
        makeUser({ id: 'u-2', nom: 'Beta', prenom: 'Marie', email: 'b@y.cm', role: 'SUPERVISEUR' }),
      ]),
      clients: of([]),
    });
    cmp.fSearch.set('alpha');
    expect(cmp.filtered().map((u) => u.id)).toEqual(['u-1']);
    cmp.fSearch.set('marie');
    expect(cmp.filtered().map((u) => u.id)).toEqual(['u-2']);
    cmp.fSearch.set('b@y');
    expect(cmp.filtered().map((u) => u.id)).toEqual(['u-2']);
    cmp.fSearch.set('');
    cmp.fRole.set('AGENT');
    expect(cmp.filtered().map((u) => u.id)).toEqual(['u-1']);
  });

  it('isInternal distingue les rôles internes', () => {
    expect(cmp.isInternal(makeUser({ role: 'ADMIN' }))).toBe(true);
    expect(cmp.isInternal(makeUser({ role: 'AGENT' }))).toBe(true);
    expect(cmp.isInternal(makeUser({ role: 'CLIENT_PP' }))).toBe(false);
  });

  // ── Formulaire création / édition ──
  it('openCreate ouvre le formulaire avec un mot de passe généré', () => {
    cmp.openCreate();
    expect(cmp.showForm()).toBe(true);
    expect(cmp.editingId()).toBeNull();
    expect(cmp.form.password).toHaveLength(12);
  });

  it('openCreate referme le formulaire déjà ouvert (mode création)', () => {
    cmp.openCreate();
    cmp.openCreate();
    expect(cmp.showForm()).toBe(false);
  });

  it('startEdit charge les champs et passe en édition', () => {
    const u = makeUser({ id: 'u-9', nom: 'Nom', prenom: 'Pre', email: 'e@x.cm', role: 'SUPERVISEUR', statut: 'SUSPENDU' });
    cmp.startEdit(u);
    expect(cmp.editingId()).toBe('u-9');
    expect(cmp.form.nom).toBe('Nom');
    expect(cmp.form.statut).toBe('SUSPENDU');
    expect(cmp.showForm()).toBe(true);
  });

  it('cancelForm ferme le formulaire et efface l’édition', () => {
    cmp.startEdit(makeUser());
    cmp.cancelForm();
    expect(cmp.showForm()).toBe(false);
    expect(cmp.editingId()).toBeNull();
  });

  // ── save ──
  it('save refuse un nom ou un e-mail vide', () => {
    cmp.form = { nom: '', prenom: '', email: '', password: 'motdepasse12', role: 'AGENT', statut: 'ACTIF' };
    cmp.save();
    expect(cmp.errorMsg()).toContain('obligatoires');
    expect(api.createUser).not.toHaveBeenCalled();
  });

  it('save (création) refuse un mot de passe trop court', () => {
    cmp.editingId.set(null);
    cmp.form = { nom: 'X', prenom: '', email: 'x@x.cm', password: 'court', role: 'AGENT', statut: 'ACTIF' };
    cmp.save();
    expect(cmp.errorMsg()).toContain('8 caractères');
    expect(api.createUser).not.toHaveBeenCalled();
  });

  it('save (création) réussie crée le compte et notifie', () => {
    cmp.editingId.set(null);
    cmp.form = { nom: 'Nouveau', prenom: 'P', email: 'n@x.cm', password: 'motdepasse12', role: 'AGENT', statut: 'ACTIF' };
    cmp.save();
    expect(api.createUser).toHaveBeenCalledWith(expect.objectContaining({ email: 'n@x.cm', role: 'AGENT' }));
    expect(toast.success).toHaveBeenCalledWith('Compte créé', 'Nouveau');
    expect(cmp.showForm()).toBe(false);
  });

  it('save (édition) réussie met à jour le compte', () => {
    cmp.editingId.set('u-1');
    cmp.form = { nom: 'Modif', prenom: 'P', email: 'm@x.cm', password: '', role: 'AGENT', statut: 'SUSPENDU' };
    cmp.save();
    expect(api.updateUser).toHaveBeenCalledWith('u-1', expect.objectContaining({ nom: 'Modif', statut: 'SUSPENDU' }));
    expect(toast.success).toHaveBeenCalledWith('Compte modifié', 'Modif');
  });

  it('save en échec affiche le message via AuthService', () => {
    api.createUser.mockReturnValueOnce(throwError(() => new Error('boom')));
    cmp.editingId.set(null);
    cmp.form = { nom: 'X', prenom: '', email: 'x@x.cm', password: 'motdepasse12', role: 'AGENT', statut: 'ACTIF' };
    cmp.save();
    expect(cmp.saving()).toBe(false);
    expect(cmp.errorMsg()).toBe('Erreur métier.');
  });

  // ── Réinitialisation mot de passe ──
  it('askResetPassword arme la cible et vide le champ', () => {
    cmp.resetPwd = 'ancien';
    cmp.askResetPassword(makeUser({ id: 'u-5' }));
    expect(cmp.resetTarget()?.id).toBe('u-5');
    expect(cmp.resetPwd).toBe('');
  });

  it('confirmResetPassword sans cible ne fait rien', () => {
    cmp.resetTarget.set(null);
    cmp.confirmResetPassword();
    expect(api.resetUserPassword).not.toHaveBeenCalled();
  });

  it('confirmResetPassword refuse un mot de passe choisi trop court', () => {
    cmp.askResetPassword(makeUser());
    cmp.resetPwd = 'abc';
    cmp.confirmResetPassword();
    expect(toast.error).toHaveBeenCalledWith('Mot de passe trop court', expect.any(String));
    expect(api.resetUserPassword).not.toHaveBeenCalled();
  });

  it('confirmResetPassword réussi affiche le mot de passe provisoire', () => {
    cmp.askResetPassword(makeUser({ id: 'u-5', email: 'e@x.cm' }));
    cmp.resetPwd = '';
    cmp.confirmResetPassword();
    expect(api.resetUserPassword).toHaveBeenCalledWith('u-5', undefined);
    expect(cmp.resetResult()).toEqual({ email: 'e@x.cm', password: 'TempPwd12345' });
    expect(cmp.resetTarget()).toBeNull();
  });

  it('confirmResetPassword en échec notifie', () => {
    api.resetUserPassword.mockReturnValueOnce(throwError(() => new Error('x')));
    cmp.askResetPassword(makeUser());
    cmp.resetPwd = 'motdepasse12';
    cmp.confirmResetPassword();
    expect(toast.error).toHaveBeenCalledWith('Échec', expect.any(String));
    expect(cmp.resetting()).toBe(false);
  });

  // ── Suppression ──
  it('confirmDelete sans cible ne fait rien', () => {
    cmp.deleteTarget.set(null);
    cmp.confirmDelete();
    expect(api.deleteUser).not.toHaveBeenCalled();
  });

  it('askDelete + confirmDelete réussi supprime et notifie', () => {
    cmp.askDelete(makeUser({ id: 'u-7', email: 'g@x.cm' }));
    expect(cmp.deleteTarget()?.id).toBe('u-7');
    cmp.confirmDelete();
    expect(api.deleteUser).toHaveBeenCalledWith('u-7');
    expect(toast.success).toHaveBeenCalledWith('Compte supprimé', expect.stringContaining('g@x.cm'));
    expect(cmp.deleteTarget()).toBeNull();
  });

  it('confirmDelete gère un conflit 409 (compte lié)', () => {
    api.deleteUser.mockReturnValueOnce(throwError(() => ({ status: 409, error: { error: { message: 'Lié à des ordres.' } } })));
    cmp.askDelete(makeUser());
    cmp.confirmDelete();
    expect(toast.error).toHaveBeenCalledWith('Suppression refusée', 'Lié à des ordres.');
  });

  it('confirmDelete gère une erreur générique', () => {
    api.deleteUser.mockReturnValueOnce(throwError(() => ({ status: 500 })));
    cmp.askDelete(makeUser());
    cmp.confirmDelete();
    expect(toast.error).toHaveBeenCalledWith('Suppression refusée', 'Suppression impossible.');
  });

  // ── copyPassword ──
  it('copyPassword ne fait rien sans résultat', () => {
    cmp.resetResult.set(null);
    cmp.copyPassword();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('copyPassword copie et notifie en cas de succès', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    cmp.resetResult.set({ email: 'e@x.cm', password: 'ABC' });
    cmp.copyPassword();
    await Promise.resolve();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('ABC');
    expect(toast.success).toHaveBeenCalledWith('Copié', expect.any(String));
  });

  it('copyPassword notifie une erreur de copie', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(() => Promise.reject(new Error('no'))) }, configurable: true });
    cmp.resetResult.set({ email: 'e@x.cm', password: 'ABC' });
    cmp.copyPassword();
    await Promise.resolve();
    await Promise.resolve();
    expect(toast.error).toHaveBeenCalledWith('Erreur', expect.any(String));
  });

  // ── Matrice RBAC ──
  it('permLabel renvoie un libellé de permission', () => {
    expect(typeof cmp.permLabel(cmp.allPermissions[0])).toBe('string');
  });

  it('hasPerm lit la matrice de rôle', () => {
    const perm = DEFAULT_ROLE_PERMISSIONS['ADMIN'][0];
    expect(cmp.hasPerm('ADMIN', perm)).toBe(true);
  });

  it('togglePerm délègue quand la matrice est éditable', () => {
    const perm = cmp.allPermissions[0];
    cmp.togglePerm('AGENT', perm);
    expect(data.toggleRolePermission).toHaveBeenCalledWith('AGENT', perm);
  });

  it('togglePerm est bloqué en lecture seule (non-admin)', () => {
    build({ role: 'AGENT' });
    cmp.togglePerm('AGENT', cmp.allPermissions[0]);
    expect(data.toggleRolePermission).not.toHaveBeenCalled();
  });

  // ─── Rendu du gabarit ─────────────────────────────────────────────────────
  // Le gabarit est inline : ses branches comptent dans la couverture de lignes.

  describe('rendu', () => {
    let fixture: ReturnType<typeof TestBed.createComponent<BoUsers>>;

    /** Monte ET rend le composant, là où build() n'instancie que la classe. */
    function render(opts: { role?: string; permissions?: string[]; users?: any; clients?: any } = {}) {
      TestBed.resetTestingModule();
      data = makeMockData(opts);
      api = makeApi(opts);
      auth = makeAuth();
      toast = makeToast();
      TestBed.configureTestingModule({
        imports: [BoUsers],
        providers: [
          { provide: MockData, useValue: data },
          { provide: ApiService, useValue: api },
          { provide: AuthService, useValue: auth },
          { provide: ToastService, useValue: toast },
        ],
      });
      fixture = TestBed.createComponent(BoUsers);
      cmp = fixture.componentInstance;
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    }

    /** `form` est un objet simple : le muter ne notifie pas le mode zoneless. */
    function refresh() {
      fixture.componentRef.changeDetectorRef.markForCheck();
      fixture.detectChanges();
    }

    const btn = (el: HTMLElement, libelle: string) =>
      Array.from(el.querySelectorAll('button'))
        .find((b) => b.textContent?.trim() === libelle) as HTMLButtonElement;

    /** La page comporte deux tableaux (liste des comptes, puis matrice RBAC) ;
     *  ils n'ont pas le même parent, d'où l'index plutôt que `:first-of-type`. */
    const lignesComptes = (el: HTMLElement) =>
      el.querySelectorAll('table')[0].querySelectorAll('tbody tr');

    // ── Liste ───────────────────────────────────────────────────────────────

    it('affiche une ligne par compte avec son badge de statut', () => {
      const el = render({
        users: of([makeUser({ id: 'a', statut: 'ACTIF' }), makeUser({ id: 'b', statut: 'SUSPENDU' })]),
        clients: of([]),
      });
      expect(lignesComptes(el)).toHaveLength(2);
      expect(el.textContent).toContain('Actif');
      expect(el.textContent).toContain('Suspendu');
    });

    it('affiche l’état vide quand aucun compte ne correspond au filtre', () => {
      const el = render({ users: of([]), clients: of([]) });
      const lignes = lignesComptes(el);
      expect(lignes).toHaveLength(1);
      expect(lignes[0].textContent).toContain('Aucun compte');
    });

    it('un administrateur voit les actions par ligne', () => {
      const el = render({ role: 'ADMIN' });
      expect(el.textContent).toContain('Modifier');
      expect(el.textContent).toContain('Réinitialiser MDP');
      expect(el.textContent).toContain('Supprimer');
    });

    it('un non-administrateur ne voit aucune action par ligne', () => {
      const el = render({ role: 'AGENT' });
      const cellule = el.querySelector('tbody tr td:last-child')!;
      expect(cellule.textContent).not.toContain('Modifier');
      expect(cellule.textContent).not.toContain('Supprimer');
    });

    // ── Formulaire ──────────────────────────────────────────────────────────

    it('le formulaire est masqué puis révélé par « Nouvel utilisateur »', () => {
      const el = render({ role: 'ADMIN' });
      expect(el.querySelector('input[name="nom"], #nom, .card form')).toBeDefined();
      expect(cmp.showForm()).toBe(false);

      btn(el, '+ Nouvel utilisateur').click();
      fixture.detectChanges();

      expect(cmp.showForm()).toBe(true);
      expect(btn(el, '✕ Fermer')).toBeDefined();
      expect(el.textContent).toContain('Générer');
    });

    it('en création, le sélecteur de rôle n’expose que les rôles assignables', () => {
      const el = render({ role: 'ADMIN' });
      cmp.openCreate();
      fixture.detectChanges();

      const roles = Array.from(el.querySelectorAll('select'))[0];
      const valeurs = Array.from(roles.querySelectorAll('option')).map((o) => o.getAttribute('value'));
      expect(valeurs).toEqual(['AGENT', 'SUPERVISEUR', 'ADMIN']);
    });

    it('en édition, le champ mot de passe et le sélecteur de rôle disparaissent', () => {
      const el = render({ role: 'ADMIN' });
      cmp.startEdit(makeUser({ id: 'u-1' }));
      fixture.detectChanges();

      expect(cmp.editingId()).toBe('u-1');
      expect(el.textContent).not.toContain('Générer');
    });

    it('le bouton « Générer » régénère un mot de passe provisoire', () => {
      const el = render({ role: 'ADMIN' });
      cmp.openCreate(); // pré-remplit déjà un mot de passe aléatoire
      fixture.detectChanges();

      const initial = cmp.form.password;
      expect(initial).toHaveLength(12);

      btn(el, '↺ Générer').click();
      refresh();

      expect(cmp.form.password).toHaveLength(12);
      expect(cmp.form.password).not.toBe(initial);
    });

    it('le message d’erreur du formulaire est rendu', () => {
      const el = render({ role: 'ADMIN' });
      cmp.openCreate();
      cmp.errorMsg.set('Adresse déjà utilisée.');
      fixture.detectChanges();

      expect(el.textContent).toContain('Adresse déjà utilisée.');
    });

    it('« Annuler » referme le formulaire', () => {
      const el = render({ role: 'ADMIN' });
      cmp.openCreate();
      fixture.detectChanges();

      btn(el, 'Annuler').click();
      fixture.detectChanges();
      expect(cmp.showForm()).toBe(false);
    });

    // ── Modales ─────────────────────────────────────────────────────────────

    it('la modale de réinitialisation nomme l’utilisateur ciblé', () => {
      const el = render({ role: 'ADMIN' });
      cmp.askResetPassword(makeUser({ nom: 'Dupont', email: 'jean@x.cm' }));
      fixture.detectChanges();

      expect(el.textContent).toContain('Dupont');
      expect(el.textContent).toContain('jean@x.cm');
      expect(btn(el, 'Réinitialiser')).toBeDefined();
    });

    it('la modale de réinitialisation se ferme via Annuler', () => {
      const el = render({ role: 'ADMIN' });
      cmp.askResetPassword(makeUser());
      fixture.detectChanges();

      btn(el, 'Annuler').click();
      fixture.detectChanges();
      expect(cmp.resetTarget()).toBeNull();
    });

    it('la modale de suppression avertit et se ferme via Annuler', () => {
      const el = render({ role: 'ADMIN' });
      cmp.askDelete(makeUser({ nom: 'Dupont' }));
      fixture.detectChanges();

      expect(el.textContent).toContain('Dupont');
      expect(btn(el, 'Supprimer définitivement')).toBeDefined();

      btn(el, 'Annuler').click();
      fixture.detectChanges();
      expect(cmp.deleteTarget()).toBeNull();
    });

    it('la modale de résultat affiche le mot de passe provisoire une seule fois', () => {
      const el = render({ role: 'ADMIN' });
      cmp.resetResult.set({ email: 'jean@x.cm', password: 'TempPwd12345' } as any);
      fixture.detectChanges();

      expect(el.textContent).toContain('jean@x.cm');
      expect(el.textContent).toContain("qu'une seule fois");
      const champ = Array.from(el.querySelectorAll('input')).find((i) => i.readOnly)!;
      expect(champ.value).toBe('TempPwd12345');

      btn(el, 'Fermer').click();
      fixture.detectChanges();
      expect(cmp.resetResult()).toBeNull();
    });

    it('« Copier » place le mot de passe dans le presse-papiers et notifie', async () => {
      const writeText = vi.fn(() => Promise.resolve());
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

      const el = render({ role: 'ADMIN' });
      cmp.resetResult.set({ email: 'jean@x.cm', password: 'TempPwd12345' } as any);
      fixture.detectChanges();

      btn(el, 'Copier').click();
      await Promise.resolve();

      expect(writeText).toHaveBeenCalledWith('TempPwd12345');
      expect(toast.success).toHaveBeenCalledWith('Copié', 'Mot de passe provisoire copié.');
    });

    it('« Copier » notifie l’échec si le presse-papiers est refusé', async () => {
      const writeText = vi.fn(() => Promise.reject(new Error('refus')));
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

      const el = render({ role: 'ADMIN' });
      cmp.resetResult.set({ email: 'jean@x.cm', password: 'TempPwd12345' } as any);
      fixture.detectChanges();

      btn(el, 'Copier').click();
      await Promise.resolve();
      await Promise.resolve();

      expect(toast.error).toHaveBeenCalledWith('Erreur', 'Copie impossible.');
    });

    // ── Matrice RBAC ────────────────────────────────────────────────────────

    it('la matrice RBAC est éditable pour un administrateur', () => {
      const el = render({ role: 'ADMIN' });
      const cases = el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
      expect(cases.length).toBeGreaterThan(0);
      expect(Array.from(cases).every((c) => c.disabled)).toBe(false);
      expect(el.textContent).not.toContain('Lecture seule');
    });

    it('la matrice RBAC est en lecture seule pour un non-administrateur', () => {
      const el = render({ role: 'SUPERVISEUR' });
      const cases = el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
      expect(Array.from(cases).every((c) => c.disabled)).toBe(true);
      expect(el.textContent).toContain('Lecture seule');
    });

    it('cocher une case de la matrice délègue au store', () => {
      const el = render({ role: 'ADMIN' });
      const premiere = el.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      premiere.dispatchEvent(new Event('change'));
      expect(data.toggleRolePermission).toHaveBeenCalledOnce();
    });
  });
});
