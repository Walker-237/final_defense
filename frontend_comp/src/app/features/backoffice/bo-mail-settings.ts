import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable, switchMap } from 'rxjs';
import { ApiService, MailSettings } from '../../core/services/api';
import { ToastService } from '../../core/services/toast';

/**
 * Espace d'administration — paramètres de connexion à la messagerie (SMTP).
 *
 * Réservé à l'administrateur. Permet de configurer l'envoi d'e-mails sans
 * toucher au code ni aux variables d'environnement. Le mot de passe n'est
 * jamais renvoyé par le backend (write-only) : un indicateur signale s'il est
 * déjà défini, et le laisser vide le conserve tel quel.
 */
@Component({
  selector: 'afb-bo-mail-settings',
  imports: [FormsModule],
  template: `
    <div class="max-w-3xl">
      <div class="mb-6">
        <h1 class="text-xl sm:text-2xl font-bold">Administration · Messagerie</h1>
        <p class="text-sm text-gray-500">
          Paramètres de connexion au serveur d'envoi d'e-mails (SMTP). Utilisés
          pour l'envoi serveur du catalogue d'émissions et les notifications.
        </p>
      </div>

      @if (loading()) {
        <div class="card p-8 text-center text-gray-400 text-sm">Chargement…</div>
      } @else {
        <div class="card">
          <div class="card-header">
            <h2 class="font-semibold">Serveur SMTP</h2>
            <span class="badge" [class.bg-emerald-100]="form.enabled" [class.text-emerald-700]="form.enabled"
                  [class.bg-gray-100]="!form.enabled" [class.text-gray-600]="!form.enabled">
              {{ form.enabled ? 'Activée' : 'Désactivée' }}
            </span>
          </div>
          @if (envManaged()) {
            <div class="mx-6 mt-4 rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800">
              🔒 La connexion SMTP est <b>imposée par les variables d'environnement</b> du serveur
              (SMTP_HOST/USERNAME/PASSWORD…). Les champs ci-dessous sont en lecture seule ;
              modifiez-les dans le fichier <span class="font-mono">.env</span> puis redéployez.
              Seuls le logo et la signature restent modifiables ici.
            </div>
          }
          <div class="card-body grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="sm:col-span-2">
              <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" [(ngModel)]="form.enabled" name="enabled" [disabled]="envManaged()">
                Activer l'envoi d'e-mails via ce serveur
              </label>
              <p class="text-[11px] text-gray-500 mt-1">
                Désactivée, la plateforme journalise les e-mails sans les envoyer (mode simulation).
              </p>
            </div>

            <div>
              <label class="label">Hôte SMTP</label>
              <input class="input" [(ngModel)]="form.host" name="host" placeholder="smtp.afriland.cm" [disabled]="envManaged()">
            </div>
            <div>
              <label class="label">Port</label>
              <input class="input" type="number" min="1" max="65535" [(ngModel)]="form.port" name="port" [disabled]="envManaged()">
            </div>

            <div>
              <label class="label">Nom d'utilisateur</label>
              <input class="input" [(ngModel)]="form.username" name="username" autocomplete="off"
                     placeholder="compte de service SMTP" [disabled]="envManaged()">
            </div>
            <div>
              <label class="label">
                Mot de passe
                @if (settings()?.passwordSet) { <span class="text-[11px] text-emerald-600">● défini</span> }
              </label>
              <input class="input" type="password" [(ngModel)]="password" name="password" autocomplete="new-password"
                     [disabled]="envManaged()"
                     [placeholder]="settings()?.passwordSet ? '•••••••• (laisser vide = inchangé)' : 'mot de passe SMTP'">
            </div>

            <div>
              <label class="label">Adresse expéditeur</label>
              <input class="input" type="email" [(ngModel)]="form.fromAddress" name="fromAddress"
                     placeholder="no-reply&#64;afriland.cm" [disabled]="envManaged()">
            </div>
            <div>
              <label class="label">Nom expéditeur</label>
              <input class="input" [(ngModel)]="form.fromName" name="fromName"
                     placeholder="Afriland First Bank - DFT" [disabled]="envManaged()">
            </div>

            <div class="flex items-center gap-4 sm:col-span-2">
              <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" [(ngModel)]="form.auth" name="auth" [disabled]="envManaged()"> Authentification (AUTH)
              </label>
              <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" [(ngModel)]="form.starttls" name="starttls" [disabled]="envManaged()"> STARTTLS
              </label>
            </div>

            <!-- Personnalisation de l'habillage des e-mails (logo + message) -->
            <div class="sm:col-span-2 border-t pt-4 mt-1">
              <h3 class="font-semibold text-sm mb-1">Personnalisation des e-mails</h3>
              <p class="text-[11px] text-gray-500 mb-3">
                Le logo s'affiche en en-tête et le message en pied de chaque e-mail (OTP, réinitialisation, diffusion).
              </p>
            </div>
            <div class="sm:col-span-2">
              <label class="label">Logo (URL de l'image)</label>
              <input class="input" [(ngModel)]="form.logoUrl" name="logoUrl"
                     placeholder="https://… (vide = logo Afriland par défaut)">
              <div class="mt-2 flex items-center gap-3">
                <span class="text-[11px] text-gray-500">Aperçu :</span>
                <img [src]="form.logoUrl || '/Logo_Afriland.png'" alt="Aperçu logo" class="max-h-10 border rounded p-1 bg-white">
              </div>
            </div>
            <div class="sm:col-span-2">
              <label class="label">Message / signature (pied d'e-mail)</label>
              <textarea class="input min-h-[90px]" [(ngModel)]="form.signature" name="signature"
                        placeholder="Ex. Afriland First Bank — Direction des Ressources et Investissements. Cet e-mail est automatique, merci de ne pas y répondre."></textarea>
              <p class="text-[11px] text-gray-500 mt-1">Le HTML simple est autorisé (ex. &lt;br/&gt; pour un retour à la ligne).</p>
            </div>
          </div>

          <div class="px-6 pb-6 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
            <div class="flex items-center gap-2">
              <input class="input w-56" type="email" [(ngModel)]="testTo" name="testTo"
                     placeholder="adresse pour test">
              <button class="btn btn-outline" (click)="sendTest()" [disabled]="busy()">
                {{ busy() ? '…' : 'Envoyer un test' }}
              </button>
            </div>
            <button class="btn btn-primary" (click)="save()" [disabled]="busy()">
              {{ busy() ? 'Enregistrement…' : 'Enregistrer' }}
            </button>
          </div>
        </div>

        <div class="text-[11px] text-gray-400 mt-4 leading-relaxed">
          • Le mot de passe est chiffré au repos (AES-GCM) et n'est jamais renvoyé par l'API.<br/>
          • Toute modification et chaque test sont tracés dans le journal d'audit.<br/>
          • Réservé à l'administrateur (rôle ADMIN).
        </div>
      }
    </div>
  `,
})
export class BoMailSettings {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  loading = signal(true);
  busy = signal(false);
  settings = signal<MailSettings | null>(null);
  /** Connexion SMTP imposée par l'environnement -> champs en lecture seule. */
  envManaged = signal(false);
  password = '';
  testTo = '';

  form = {
    host: '', port: 587, username: '', fromAddress: '', fromName: '',
    auth: true, starttls: true, enabled: false, logoUrl: '', signature: '',
  };

  constructor() {
    this.reload();
  }

  private reload(): void {
    this.loading.set(true);
    this.api.getMailSettings().subscribe({
      next: (s) => {
        this.settings.set(s);
        this.envManaged.set(!!s.envManaged);
        this.form = {
          host: s.host, port: s.port, username: s.username,
          fromAddress: s.fromAddress, fromName: s.fromName,
          auth: s.auth, starttls: s.starttls, enabled: s.enabled,
          logoUrl: s.logoUrl ?? '', signature: s.signature ?? '',
        };
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.toast.error('Erreur', 'Chargement impossible.');
      },
    });
  }

  /** Enregistre la configuration courante du formulaire. Le mot de passe est
   *  omis s'il est laissé vide (conservé côté serveur). */
  private persist(): Observable<MailSettings> {
    const body = {
      ...this.form,
      port: Number(this.form.port) || 587,
      // password omis si vide -> conservé côté serveur.
      ...(this.password.trim() ? { password: this.password } : {}),
    };
    return this.api.updateMailSettings(body);
  }

  save(): void {
    this.busy.set(true);
    this.persist().subscribe({
      next: (s) => {
        this.busy.set(false);
        this.password = '';
        this.settings.set(s);
        this.toast.success('Enregistré', 'Paramètres de messagerie mis à jour.');
      },
      error: () => {
        this.busy.set(false);
        this.toast.error('Erreur', 'Enregistrement impossible.');
      },
    });
  }

  sendTest(): void {
    const to = this.testTo.trim();
    if (!to.includes('@')) {
      this.toast.error('Adresse invalide', 'Renseignez une adresse e-mail de test.');
      return;
    }
    this.busy.set(true);
    // On enregistre d'abord la configuration affichée pour que le test porte sur
    // ce que l'utilisateur voit à l'écran (et non sur l'ancienne config en base).
    this.persist()
      .pipe(switchMap((s) => {
        this.password = '';
        this.settings.set(s);
        return this.api.testMailSettings(to);
      }))
      .subscribe({
        next: (r) => {
          this.busy.set(false);
          if (r.status === 'SENT') {
            this.toast.success('Test envoyé', `E-mail de test envoyé à ${to}.`);
          } else if (r.status === 'SIMULATED') {
            this.toast.warn('Mode simulation',
              "Activez « l'envoi d'e-mails » et renseignez l'hôte SMTP pour un envoi réel.");
          } else {
            this.toast.error('Échec', "L'envoi a échoué. Vérifiez l'hôte, le port et les identifiants SMTP.");
          }
        },
        error: () => {
          this.busy.set(false);
          this.toast.error('Erreur', 'Test impossible.');
        },
      });
  }
}
