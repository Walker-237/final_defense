import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, LdapSettings } from '../../core/services/api';
import { ToastService } from '../../core/services/toast';

/**
 * Espace d'administration — connexion LDAP / Active Directory.
 *
 * Réservé à l'administrateur. Permet de configurer la liaison à l'annuaire
 * d'entreprise (AD) sans toucher au code ni aux variables d'environnement. Le mot
 * de passe du compte de service n'est jamais renvoyé par le backend (write-only) :
 * un indicateur signale s'il est déjà défini, et le laisser vide le conserve.
 */
@Component({
  selector: 'afb-bo-ldap-settings',
  imports: [FormsModule],
  template: `
    <div class="max-w-3xl">
      <div class="mb-6">
        <h1 class="text-xl sm:text-2xl font-bold">Administration · LDAP / Active Directory</h1>
        <p class="text-sm text-gray-500">
          Paramètres de connexion à l'annuaire d'entreprise (Active Directory) pour
          l'authentification des utilisateurs internes.
        </p>
      </div>

      @if (loading()) {
        <div class="card p-8 text-center text-gray-400 text-sm">Chargement…</div>
      } @else {
        <div class="card">
          <div class="card-header">
            <h2 class="font-semibold">Annuaire LDAP</h2>
            <span class="badge" [class.bg-emerald-100]="form.enabled" [class.text-emerald-700]="form.enabled"
                  [class.bg-gray-100]="!form.enabled" [class.text-gray-600]="!form.enabled">
              {{ form.enabled ? 'Activé' : 'Désactivé' }}
            </span>
          </div>
          <div class="card-body grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="sm:col-span-2">
              <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" [(ngModel)]="form.enabled" name="enabled">
                Activer l'authentification via LDAP / Active Directory
              </label>
              <p class="text-[11px] text-gray-500 mt-1">
                Désactivé, la plateforme utilise uniquement l'authentification locale (base de données).
              </p>
            </div>

            <div>
              <label class="label">Hôte</label>
              <input class="input" [(ngModel)]="form.host" name="host" placeholder="ad.afriland.cm">
            </div>
            <div>
              <label class="label">Port</label>
              <input class="input" type="number" min="1" max="65535" [(ngModel)]="form.port" name="port">
            </div>

            <div class="flex items-center gap-4 sm:col-span-2">
              <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" [(ngModel)]="form.ssl" name="ssl" (change)="onSsl()"> SSL (LDAPS)
              </label>
              <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" [(ngModel)]="form.startTls" name="startTls" (change)="onStartTls()"> STARTTLS
              </label>
              <span class="text-[11px] text-gray-400">Port usuel : 389 (LDAP/STARTTLS) · 636 (LDAPS)</span>
            </div>

            <div class="sm:col-span-2">
              <label class="label">Base DN</label>
              <input class="input font-mono" [(ngModel)]="form.baseDn" name="baseDn"
                     placeholder="DC=afriland,DC=cm">
            </div>

            <div class="sm:col-span-2">
              <label class="label">Compte de service (Bind DN)</label>
              <input class="input font-mono" [(ngModel)]="form.bindDn" name="bindDn" autocomplete="off"
                     placeholder="CN=svc-svt,OU=Services,DC=afriland,DC=cm">
            </div>
            <div class="sm:col-span-2">
              <label class="label">
                Mot de passe du compte de service
                @if (settings()?.bindPasswordSet) { <span class="text-[11px] text-emerald-600">● défini</span> }
              </label>
              <input class="input" type="password" [(ngModel)]="bindPassword" name="bindPassword" autocomplete="new-password"
                     [placeholder]="settings()?.bindPasswordSet ? '•••••••• (laisser vide = inchangé)' : 'mot de passe du compte de bind'">
            </div>

            <div class="sm:col-span-2">
              <label class="label">Base de recherche des utilisateurs (optionnel)</label>
              <input class="input font-mono" [(ngModel)]="form.userSearchBase" name="userSearchBase"
                     placeholder="OU=Utilisateurs,DC=afriland,DC=cm">
            </div>
            <div class="sm:col-span-2">
              <label class="label">Filtre de recherche utilisateur</label>
              <input class="input font-mono" [(ngModel)]="form.userSearchFilter" name="userSearchFilter"
                     placeholder="(sAMAccountName=&#123;0&#125;)">
              <p class="text-[11px] text-gray-500 mt-1">
                <code>&#123;0&#125;</code> est remplacé par l'identifiant saisi. Pour AD : <code>(sAMAccountName=&#123;0&#125;)</code>
                ou <code>(userPrincipalName=&#123;0&#125;)</code>.
              </p>
            </div>
          </div>

          <div class="px-6 pb-6 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
            <button class="btn btn-outline" (click)="testConn()" [disabled]="busy()">
              {{ busy() ? '…' : '🔌 Tester la connexion' }}
            </button>
            <button class="btn btn-primary" (click)="save()" [disabled]="busy()">
              {{ busy() ? 'Enregistrement…' : 'Enregistrer' }}
            </button>
          </div>

          @if (testMsg()) {
            <div class="mx-6 mb-6 p-3 rounded-lg text-sm"
                 [class.bg-emerald-50]="testOk()" [class.text-emerald-800]="testOk()"
                 [class.bg-red-50]="!testOk()" [class.text-red-800]="!testOk()">
              {{ testOk() ? '✓ ' : '✕ ' }}{{ testMsg() }}
            </div>
          }
        </div>

        <div class="text-[11px] text-gray-400 mt-4 leading-relaxed">
          • Le mot de passe du compte de service est chiffré au repos (AES-GCM) et n'est jamais renvoyé par l'API.<br/>
          • Le test doit être effectué après enregistrement (il utilise les paramètres sauvegardés).<br/>
          • Toute modification et chaque test sont tracés dans le journal d'audit. Réservé à l'administrateur.
        </div>
      }
    </div>
  `,
})
export class BoLdapSettings {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  loading = signal(true);
  busy = signal(false);
  settings = signal<LdapSettings | null>(null);
  bindPassword = '';
  testMsg = signal('');
  testOk = signal(false);

  form = {
    enabled: false, host: '', port: 389, ssl: false, startTls: false,
    baseDn: '', bindDn: '', userSearchBase: '', userSearchFilter: '(sAMAccountName={0})',
  };

  constructor() {
    this.reload();
  }

  /** SSL et STARTTLS sont exclusifs ; ajuste le port usuel. */
  onSsl() {
    if (this.form.ssl) { this.form.startTls = false; if (this.form.port === 389) this.form.port = 636; }
    else if (this.form.port === 636) { this.form.port = 389; }
  }
  onStartTls() {
    if (this.form.startTls) { this.form.ssl = false; if (this.form.port === 636) this.form.port = 389; }
  }

  private reload(): void {
    this.loading.set(true);
    this.api.getLdapSettings().subscribe({
      next: (s) => {
        this.settings.set(s);
        this.form = {
          enabled: s.enabled, host: s.host, port: s.port, ssl: s.ssl, startTls: s.startTls,
          baseDn: s.baseDn, bindDn: s.bindDn, userSearchBase: s.userSearchBase,
          userSearchFilter: s.userSearchFilter || '(sAMAccountName={0})',
        };
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.toast.error('Erreur', 'Chargement impossible.');
      },
    });
  }

  save(): void {
    this.busy.set(true);
    const body = {
      ...this.form,
      port: Number(this.form.port) || 389,
      ...(this.bindPassword.trim() ? { bindPassword: this.bindPassword } : {}),
    };
    this.api.updateLdapSettings(body).subscribe({
      next: (s) => {
        this.busy.set(false);
        this.bindPassword = '';
        this.settings.set(s);
        this.toast.success('Enregistré', 'Paramètres LDAP mis à jour.');
      },
      error: (err) => {
        this.busy.set(false);
        this.toast.error('Erreur', 'Enregistrement impossible.');
      },
    });
  }

  testConn(): void {
    this.busy.set(true);
    this.testMsg.set('');
    this.api.testLdapSettings().subscribe({
      next: (r) => {
        this.busy.set(false);
        this.testOk.set(r.ok);
        this.testMsg.set(r.message);
        if (r.ok) this.toast.success('Connexion LDAP', 'Liaison à l\'annuaire réussie.');
        else this.toast.error('Échec LDAP', 'La connexion a échoué (voir le détail).');
      },
      error: (err) => {
        this.busy.set(false);
        this.testOk.set(false);
        this.testMsg.set('Test impossible.');
        this.toast.error('Erreur', 'Test impossible.');
      },
    });
  }
}
