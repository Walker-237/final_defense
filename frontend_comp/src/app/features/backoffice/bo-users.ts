import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, UserAccount } from '../../core/services/api';
import { MockData } from '../../core/services/mock-data';
import { ToastService } from '../../core/services/toast';
import { AuthService } from '../../core/services/auth-service';
import { ALL_PERMISSIONS, PERMISSION_LABELS, Permission, UserRole } from '../../core/models/models';
import { Paginator, PaginatePipe } from '../../shared/pagination';
import { generateTemporaryPassword } from '../../shared/secure-random';

const ROLE_LABELS: Record<UserRole, string> = {
  CLIENT_PP: 'Client PP',
  CLIENT_PM: 'Client PM',
  AGENT: 'Agent SVT',
  SUPERVISEUR: 'Superviseur',
  ADMIN: 'Administrateur',
};

/**
 * Comptes utilisateurs & habilitations (CSFT §M6).
 *
 * - L'agent SVT crée des comptes (persistés en base).
 * - Seul l'ADMIN peut **modifier** un compte existant (interne ou client) ;
 *   les autres acteurs sont en consultation. Le contrôle est ré-appliqué côté
 *   serveur (`PATCH /users/:id` réservé à l'admin).
 */
@Component({
  selector: 'afb-bo-users',
  imports: [FormsModule, Paginator, PaginatePipe],
  template: `
    <div>
      <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 class="text-xl sm:text-2xl font-bold">Comptes utilisateurs &amp; habilitations</h1>
          <p class="text-sm text-gray-500">Création &amp; modification : administrateur et superviseur · matrice RBAC : administrateur uniquement</p>
        </div>
        <button class="btn btn-primary" (click)="openCreate()">{{ showForm() && !editingId() ? '✕ Fermer' : '+ Nouvel utilisateur' }}</button>
      </div>

      @if (showForm()) {
        <div class="card mb-6">
          <div class="card-header"><h2 class="font-semibold">{{ editingId() ? 'Modifier le compte' : 'Nouveau compte' }}</h2></div>
          <div class="card-body grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label class="label">Nom</label><input class="input" [(ngModel)]="form.nom" name="nom"></div>
            <div><label class="label">Prénom</label><input class="input" [(ngModel)]="form.prenom" name="prenom"></div>
            <div><label class="label">E-mail</label><input class="input" type="email" [(ngModel)]="form.email" name="mail"></div>
            @if (editingId()) {
              <div>
                <label class="label">Statut</label>
                <select class="select" [(ngModel)]="form.statut" name="st">
                  <option value="ACTIF">Actif</option>
                  <option value="SUSPENDU">Suspendu</option>
                </select>
              </div>
            } @else {
              <div>
                <label class="label">Rôle</label>
                <select class="select" [(ngModel)]="form.role" name="role">
                  @for (r of assignableRoles(); track r) { <option [value]="r">{{ roleLabel(r) }}</option> }
                </select>
              </div>
              <div class="sm:col-span-2">
                <label class="label">Mot de passe provisoire (par défaut)</label>
                <div class="flex gap-2">
                  <input class="input flex-1" type="text" [(ngModel)]="form.password" name="pwd" placeholder="8 caractères minimum">
                  <button type="button" class="btn btn-outline whitespace-nowrap" (click)="form.password = randomPassword()">↺ Générer</button>
                </div>
                <p class="hint">Mot de passe temporaire à communiquer à l'utilisateur — haché en base (Argon2id), jamais stocké en clair. Solution provisoire en attendant le raccordement à l'annuaire Active Directory (AD).</p>
              </div>
            }
            @if (errorMsg()) { <div class="sm:col-span-2 text-sm text-red-600">{{ errorMsg() }}</div> }
            <div class="sm:col-span-2 flex justify-end gap-2 border-t pt-4">
              <button class="btn btn-outline" (click)="cancelForm()">Annuler</button>
              <button class="btn btn-primary" [disabled]="saving()" (click)="save()">
                {{ saving() ? 'Enregistrement…' : (editingId() ? 'Enregistrer' : 'Créer le compte') }}
              </button>
            </div>
          </div>
        </div>
      }

      <div class="card mb-4">
        <div class="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div class="sm:col-span-2">
            <label class="label">Recherche</label>
            <input class="input" placeholder="🔍 Nom, e-mail…" [ngModel]="fSearch()" (ngModelChange)="fSearch.set($event); page.set(1)" name="us">
          </div>
          <div>
            <label class="label">Rôle</label>
            <select class="select" [ngModel]="fRole()" (ngModelChange)="fRole.set($event); page.set(1)" name="ur">
              <option value="">Tous</option>
              @for (r of allRoles; track r) { <option [value]="r">{{ roleLabel(r) }}</option> }
            </select>
          </div>
        </div>
      </div>

      <div class="card overflow-hidden">
        <div class="overflow-x-auto"><table class="table min-w-[640px] sm:min-w-full">
          <thead><tr><th>Nom</th><th>E-mail</th><th>Rôle</th><th>Statut</th><th></th></tr></thead>
          <tbody>
            @for (u of (filtered() | paginate:page():10); track u.id) {
              <tr>
                <td class="font-semibold">{{ u.nom }} {{ u.prenom || '' }}</td>
                <td class="text-sm font-mono">{{ u.email }}</td>
                <td><span class="badge bg-purple-100 text-purple-700">{{ roleLabel(u.role) }}</span></td>
                <td>
                  @if (u.statut === 'ACTIF') { <span class="badge badge-publie">Actif</span> }
                  @else { <span class="badge badge-cloture">Suspendu</span> }
                </td>
                <td class="whitespace-nowrap">
                  @if (isAdmin()) {
                    <button class="text-afb-red text-sm" (click)="startEdit(u)">Modifier</button>
                    <button class="text-afb-red text-sm ml-3" (click)="askResetPassword(u)">Réinitialiser MDP</button>
                    <button class="text-afb-red text-sm ml-3" (click)="askDelete(u)">Supprimer</button>
                  } @else {
                    <span class="text-xs text-gray-400">—</span>
                  }
                </td>
              </tr>
            }
            @if (!filtered().length) {
              <tr><td colspan="5" class="text-center py-12 text-gray-400 text-sm">Aucun compte</td></tr>
            }
          </tbody>
        </table></div>
        <afb-paginator [total]="filtered().length" [pageSize]="10" [(page)]="page" />
      </div>

      <!-- Confirmation de réinitialisation -->
      @if (resetTarget()) {
        <div class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" (click)="resetTarget.set(null)">
          <div class="card w-full max-w-md" (click)="$event.stopPropagation()">
            <div class="card-header"><h2 class="font-semibold">Réinitialiser le mot de passe</h2></div>
            <div class="card-body space-y-3 text-sm">
              <p>Réinitialisation du mot de passe de
                <b>{{ resetTarget()!.nom }} {{ resetTarget()!.prenom || '' }}</b>
                (<span class="font-mono">{{ resetTarget()!.email }}</span>).</p>
              <div>
                <label class="label">Mot de passe (laisser vide = généré aléatoirement)</label>
                <div class="flex gap-2">
                  <input class="input flex-1" type="text" [(ngModel)]="resetPwd" name="resetPwd"
                         placeholder="8 caractères minimum, ou vide pour aléatoire">
                  <button type="button" class="btn btn-outline whitespace-nowrap" (click)="resetPwd = randomPassword()">↺ Générer</button>
                </div>
              </div>
              <p class="text-gray-500">L'utilisateur devra le changer à sa prochaine connexion. Ses sessions
                actives seront révoquées.</p>
            </div>
            <div class="card-body flex justify-end gap-2 border-t">
              <button class="btn btn-outline" (click)="resetTarget.set(null)">Annuler</button>
              <button class="btn btn-primary" [disabled]="resetting()" (click)="confirmResetPassword()">
                {{ resetting() ? 'Réinitialisation…' : 'Réinitialiser' }}
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Confirmation de suppression -->
      @if (deleteTarget()) {
        <div class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" (click)="deleteTarget.set(null)">
          <div class="card w-full max-w-md" (click)="$event.stopPropagation()">
            <div class="card-header"><h2 class="font-semibold text-afb-red">Supprimer le compte</h2></div>
            <div class="card-body space-y-3 text-sm">
              <p>Confirmez la suppression définitive du compte
                <b>{{ deleteTarget()!.nom }} {{ deleteTarget()!.prenom || '' }}</b>
                (<span class="font-mono">{{ deleteTarget()!.email }}</span>) ?</p>
              <p class="text-gray-500">Cette action est irréversible. Si le compte porte des opérations (ordres,
                dossier…), la suppression sera refusée : suspendez-le alors via « Modifier ».</p>
            </div>
            <div class="card-body flex justify-end gap-2 border-t">
              <button class="btn btn-outline" (click)="deleteTarget.set(null)">Annuler</button>
              <button class="btn btn-danger" [disabled]="deleting()" (click)="confirmDelete()">
                {{ deleting() ? 'Suppression…' : 'Supprimer définitivement' }}
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Mot de passe provisoire généré -->
      @if (resetResult()) {
        <div class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" (click)="resetResult.set(null)">
          <div class="card w-full max-w-md" (click)="$event.stopPropagation()">
            <div class="card-header"><h2 class="font-semibold">Mot de passe provisoire</h2></div>
            <div class="card-body space-y-3 text-sm">
              <p>Communiquez ce mot de passe provisoire à <b>{{ resetResult()!.email }}</b>.
                Il devra le changer à sa première connexion.</p>
              <div class="flex gap-2">
                <input class="input flex-1 font-mono" [value]="resetResult()!.password" readonly
                       (focus)="$any($event.target).select()">
                <button class="btn btn-outline whitespace-nowrap" (click)="copyPassword()">Copier</button>
              </div>
              <p class="text-xs text-gray-500">Ce mot de passe n'est affiché qu'une seule fois.</p>
            </div>
            <div class="card-body flex justify-end border-t">
              <button class="btn btn-primary" (click)="resetResult.set(null)">Fermer</button>
            </div>
          </div>
        </div>
      }

      <!-- Matrice des droits d'accès (RBAC) — CSFT §M6-S03 -->
      <div class="card mt-6">
        <div class="card-header"><h2 class="font-semibold">🔐 Matrice des droits d'accès (RBAC)</h2></div>
        <div class="overflow-x-auto">
          <table class="table min-w-[720px]">
            <thead>
              <tr>
                <th class="text-left">Permission</th>
                @for (r of internalRoles; track r) { <th class="text-center text-xs">{{ roleLabel(r) }}</th> }
              </tr>
            </thead>
            <tbody>
              @for (p of allPermissions; track p) {
                <tr>
                  <td class="text-sm"><div class="font-medium">{{ permLabel(p) }}</div></td>
                  @for (r of internalRoles; track r) {
                    <td class="text-center">
                      <input type="checkbox" [checked]="hasPerm(r, p)" [disabled]="!canEditMatrix()" (change)="togglePerm(r, p)">
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
        @if (!canEditMatrix()) {
          <div class="px-6 pb-4 text-xs text-gray-500">ℹ️ Lecture seule — la modification des droits RBAC est réservée à l'administrateur.</div>
        }
      </div>
    </div>
  `,
})
export class BoUsers {
  private readonly api = inject(ApiService);
  private readonly data = inject(MockData);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  internalUsers = signal<UserAccount[]>([]);
  clients = signal<UserAccount[]>([]);
  showForm = signal(false);
  editingId = signal<string | null>(null);
  saving = signal(false);
  errorMsg = signal('');
  page = signal(1);
  fSearch = signal('');
  fRole = signal('');

  internalRoles: UserRole[] = ['AGENT', 'SUPERVISEUR', 'ADMIN'];
  allRoles: UserRole[] = ['CLIENT_PP', 'CLIENT_PM', 'AGENT', 'SUPERVISEUR', 'ADMIN'];

  /**
   * Génère un mot de passe provisoire ALÉATOIRE et robuste (pas de constante en
   * dur dans le bundle). L'utilisateur devra de toute façon le changer à sa
   * première connexion (imposé côté serveur).
   */
  randomPassword(): string {
    return generateTemporaryPassword();
  }
  form = { nom: '', prenom: '', email: '', password: '', role: 'AGENT' as UserRole, statut: 'ACTIF' };

  /** Tous les comptes : acteurs internes + clients investisseurs. */
  accounts = computed(() => [...this.internalUsers(), ...this.clients()]);
  isAdmin = computed(() => this.data.currentUser().role === 'ADMIN');
  /** Création / modification de comptes : administrateur + superviseur (permission USER_MANAGE). */
  canManageUsers = computed(() => this.data.hasPermission('USER_MANAGE'));

  constructor() {
    this.reload();
  }

  assignableRoles = computed<UserRole[]>(() => {
    switch (this.data.currentUser().role) {
      case 'ADMIN':
        return ['AGENT', 'SUPERVISEUR', 'ADMIN'];
      case 'SUPERVISEUR':
        return ['AGENT', 'SUPERVISEUR'];
      case 'AGENT':
        return ['AGENT'];
      default:
        return [];
    }
  });

  filtered = computed(() => {
    const q = this.fSearch().trim().toLowerCase();
    return this.accounts().filter(
      (u) =>
        (!q || u.nom.toLowerCase().includes(q) || (u.prenom ?? '').toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) &&
        (!this.fRole() || u.role === this.fRole()),
    );
  });

  roleLabel(r: UserRole) {
    return ROLE_LABELS[r];
  }

  private reload() {
    this.api.listUsers().subscribe({ next: (u) => this.internalUsers.set(u), error: () => this.internalUsers.set([]) });
    this.api.listClients().subscribe({ next: (c) => this.clients.set(c), error: () => this.clients.set([]) });
  }

  openCreate() {
    if (this.showForm() && !this.editingId()) {
      this.showForm.set(false);
      return;
    }
    this.errorMsg.set('');
    this.editingId.set(null);
    this.form = { nom: '', prenom: '', email: '', password: this.randomPassword(), role: this.assignableRoles()[0] ?? 'AGENT', statut: 'ACTIF' };
    this.showForm.set(true);
  }

  startEdit(u: UserAccount) {
    this.errorMsg.set('');
    this.editingId.set(u.id);
    this.form = {
      nom: u.nom,
      prenom: u.prenom ?? '',
      email: u.email,
      password: '',
      role: u.role,
      statut: u.statut === 'SUSPENDU' ? 'SUSPENDU' : 'ACTIF',
    };
    this.showForm.set(true);
  }

  cancelForm() {
    this.showForm.set(false);
    this.editingId.set(null);
  }

  // ── Réinitialisation de mot de passe (interne OU client) ──────────────────
  /** Rôles internes (info d'affichage uniquement). */
  isInternal(u: UserAccount): boolean {
    return u.role === 'AGENT' || u.role === 'SUPERVISEUR' || u.role === 'ADMIN';
  }
  resetTarget = signal<UserAccount | null>(null);
  resetting = signal(false);
  resetResult = signal<{ email: string; password: string } | null>(null);
  /** Mot de passe choisi (vide = aléatoire). */
  resetPwd = '';

  askResetPassword(u: UserAccount) { this.resetPwd = ''; this.resetTarget.set(u); }

  confirmResetPassword() {
    const u = this.resetTarget();
    if (!u) return;
    const chosen = this.resetPwd.trim();
    if (chosen && chosen.length < 8) {
      this.toast.error('Mot de passe trop court', 'Au moins 8 caractères, ou laissez vide pour aléatoire.');
      return;
    }
    this.resetting.set(true);
    this.api.resetUserPassword(u.id, chosen || undefined).subscribe({
      next: (r) => {
        this.resetting.set(false);
        this.resetTarget.set(null);
        this.resetResult.set({ email: u.email, password: r.temporaryPassword });
      },
      error: () => {
        this.resetting.set(false);
        this.resetTarget.set(null);
        this.toast.error('Échec', 'Réinitialisation impossible.');
      },
    });
  }

  // ── Suppression de compte (interne OU client) ─────────────────────────────
  deleteTarget = signal<UserAccount | null>(null);
  deleting = signal(false);

  askDelete(u: UserAccount) { this.deleteTarget.set(u); }

  confirmDelete() {
    const u = this.deleteTarget();
    if (!u) return;
    this.deleting.set(true);
    this.api.deleteUser(u.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.deleteTarget.set(null);
        this.toast.success('Compte supprimé', `${u.email} a été supprimé.`);
        this.reload();
      },
      error: (err) => {
        this.deleting.set(false);
        this.deleteTarget.set(null);
        // 409 = compte lié à des opérations -> message backend explicite.
        const msg = err?.status === 409
          ? (err?.error?.error?.message || 'Compte lié à des opérations : suspendez-le plutôt.')
          : 'Suppression impossible.';
        this.toast.error('Suppression refusée', msg);
      },
    });
  }

  copyPassword() {
    const p = this.resetResult()?.password;
    if (!p) return;
    navigator.clipboard.writeText(p).then(
      () => this.toast.success('Copié', 'Mot de passe provisoire copié.'),
      () => this.toast.error('Erreur', 'Copie impossible.'),
    );
  }

  save() {
    this.errorMsg.set('');
    const f = this.form;
    if (!f.nom.trim() || !f.email.trim()) {
      this.errorMsg.set('Nom et e-mail obligatoires.');
      return;
    }
    const editId = this.editingId();
    if (!editId && f.password.length < 8) {
      this.errorMsg.set('Mot de passe : 8 caractères minimum.');
      return;
    }
    this.saving.set(true);

    const request$ = editId
      ? this.api.updateUser(editId, {
          nom: f.nom.trim(),
          prenom: f.prenom.trim(),
          email: f.email.trim(),
          statut: f.statut,
        })
      : this.api.createUser({
          email: f.email.trim(),
          password: f.password,
          role: f.role,
          nom: f.nom.trim(),
          prenom: f.prenom.trim() || undefined,
        });

    request$.subscribe({
      next: () => {
        this.saving.set(false);
        this.showForm.set(false);
        this.editingId.set(null);
        this.toast.success(editId ? 'Compte modifié' : 'Compte créé', f.nom);
        this.reload();
      },
      error: (err) => {
        this.saving.set(false);
        this.errorMsg.set(this.auth.errorMessage(err));
      },
    });
  }

  // ── Matrice RBAC (locale — CSFT §M6-S03) ──────────────────────────────────
  allPermissions: Permission[] = ALL_PERMISSIONS;
  permLabel(p: Permission) {
    return PERMISSION_LABELS[p];
  }
  hasPerm(role: UserRole, perm: Permission): boolean {
    return (this.data.rolePermissions()[role] ?? []).includes(perm);
  }
  /** CSFT §M6-S03 — la matrice RBAC n'est modifiable que par l'administrateur. */
  canEditMatrix = computed(() => this.isAdmin());
  togglePerm(role: UserRole, perm: Permission) {
    if (!this.canEditMatrix()) return;
    this.data.toggleRolePermission(role, perm);
  }
}
