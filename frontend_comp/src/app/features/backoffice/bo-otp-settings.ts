import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, OtpSettings } from '../../core/services/api';
import { ToastService } from '../../core/services/toast';

/**
 * Espace d'administration — paramètres du « serveur OTP ».
 *
 * Réservé à l'administrateur. Contrôle le canal de diffusion du code (e-mail /
 * SMS), sa longueur, sa durée de validité et le nombre de tentatives. Le code
 * est généré aléatoirement, stocké en base sous forme d'empreinte et invalidé
 * après usage. La clé d'API SMS n'est jamais renvoyée (write-only).
 */
@Component({
  selector: 'afb-bo-otp-settings',
  imports: [FormsModule],
  template: `
    <div class="max-w-3xl">
      <div class="mb-6">
        <h1 class="text-xl sm:text-2xl font-bold">Administration · Serveur OTP</h1>
        <p class="text-sm text-gray-500">
          Paramètres du code de vérification à usage unique envoyé à la connexion.
          Le code est généré aléatoirement et ne peut servir qu'une seule fois.
        </p>
      </div>

      @if (loading()) {
        <div class="card p-8 text-center text-gray-400 text-sm">Chargement…</div>
      } @else {
        <div class="card">
          <div class="card-header"><h2 class="font-semibold">Génération &amp; diffusion</h2></div>
          <div class="card-body grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="sm:col-span-2">
              <label class="label">Canal de diffusion</label>
              <select class="input" [(ngModel)]="form.canal" name="canal">
                <option value="EMAIL">E-mail</option>
                <option value="SMS">SMS</option>
                <option value="EMAIL_SMS">E-mail + SMS</option>
                <option value="LOG">Journalisation (interne)</option>
              </select>
            </div>
            <div>
              <label class="label">Longueur du code</label>
              <input class="input" type="number" min="4" max="8" [(ngModel)]="form.longueur" name="longueur"
                     (blur)="touchLongueur()" (ngModelChange)="longueurErr && touchLongueur()">
              @if (longueurErr) { <p class="text-xs text-red-600 mt-1">{{ longueurErr }}</p> }
            </div>
            <div>
              <label class="label">Durée de validité (secondes)</label>
              <input class="input" type="number" min="60" max="1800" [(ngModel)]="form.ttlSecondes" name="ttl"
                     (blur)="touchTtl()" (ngModelChange)="ttlErr && touchTtl()">
              @if (ttlErr) { <p class="text-xs text-red-600 mt-1">{{ ttlErr }}</p> }
            </div>
            <div>
              <label class="label">Tentatives autorisées</label>
              <input class="input" type="number" min="1" max="10" [(ngModel)]="form.maxTentatives" name="maxt"
                     (blur)="touchTentatives()" (ngModelChange)="tentativesErr && touchTentatives()">
              @if (tentativesErr) { <p class="text-xs text-red-600 mt-1">{{ tentativesErr }}</p> }
            </div>
          </div>

          @if (smsActive()) {
            <div class="card-body border-t grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div class="sm:col-span-2 text-sm font-medium text-gray-700">Passerelle SMS</div>
              <div class="sm:col-span-2">
                <label class="label">URL de la passerelle</label>
                <input class="input" [(ngModel)]="form.smsApiUrl" name="smsUrl"
                       placeholder="https://passerelle-sms.example/send">
              </div>
              <div>
                <label class="label">Expéditeur</label>
                <input class="input" [(ngModel)]="form.smsExpediteur" name="smsExp" placeholder="AFRILAND">
              </div>
              <div>
                <label class="label">
                  Clé d'API
                  @if (settings()?.smsApiKeySet) { <span class="text-[11px] text-emerald-600">● définie</span> }
                </label>
                <input class="input" type="password" [(ngModel)]="apiKey" name="apiKey" autocomplete="new-password"
                       [placeholder]="settings()?.smsApiKeySet ? '•••••••• (laisser vide = inchangé)' : 'clé d\\'API SMS'">
              </div>
              <p class="sm:col-span-2 text-[11px] text-gray-500">
                Le canal SMS est préparé : tant qu'aucune passerelle n'est branchée, l'envoi est simulé.
              </p>
            </div>
          }

          <div class="px-6 pb-6 flex items-center justify-end gap-2 border-t pt-4">
            <button class="btn btn-primary" (click)="save()" [disabled]="busy()">
              {{ busy() ? 'Enregistrement…' : 'Enregistrer' }}
            </button>
          </div>
        </div>

        <div class="text-[11px] text-gray-400 mt-4 leading-relaxed">
          • Le code OTP est stocké en base sous forme d'empreinte et invalidé après usage.<br/>
          • La clé d'API SMS est chiffrée au repos et n'est jamais renvoyée.<br/>
          • Réservé à l'administrateur.
        </div>
      }
    </div>
  `,
})
export class BoOtpSettings {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  loading = signal(true);
  busy = signal(false);
  settings = signal<OtpSettings | null>(null);
  apiKey = '';

  form = {
    canal: 'EMAIL' as OtpSettings['canal'],
    longueur: 6, ttlSecondes: 300, maxTentatives: 5,
    smsApiUrl: '', smsExpediteur: '',
  };

  longueurErr = '';
  ttlErr = '';
  tentativesErr = '';

  touchLongueur() {
    const v = Number(this.form.longueur);
    this.longueurErr = Number.isNaN(v) || v < 4 || v > 8 ? 'Entre 4 et 8 chiffres.' : '';
  }
  touchTtl() {
    const v = Number(this.form.ttlSecondes);
    this.ttlErr = Number.isNaN(v) || v < 60 || v > 1800 ? 'Entre 60 et 1 800 secondes.' : '';
  }
  touchTentatives() {
    const v = Number(this.form.maxTentatives);
    this.tentativesErr = Number.isNaN(v) || v < 1 || v > 10 ? 'Entre 1 et 10 tentatives.' : '';
  }

  smsActive(): boolean {
    return this.form.canal === 'SMS' || this.form.canal === 'EMAIL_SMS';
  }

  constructor() {
    this.reload();
  }

  private reload(): void {
    this.loading.set(true);
    this.api.getOtpSettings().subscribe({
      next: (s) => {
        this.settings.set(s);
        this.form = {
          canal: s.canal, longueur: s.longueur, ttlSecondes: s.ttlSecondes,
          maxTentatives: s.maxTentatives, smsApiUrl: s.smsApiUrl, smsExpediteur: s.smsExpediteur,
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
      canal: this.form.canal,
      longueur: Number(this.form.longueur) || 6,
      ttlSecondes: Number(this.form.ttlSecondes) || 300,
      maxTentatives: Number(this.form.maxTentatives) || 5,
      smsApiUrl: this.form.smsApiUrl,
      smsExpediteur: this.form.smsExpediteur,
      ...(this.apiKey.trim() ? { smsApiKey: this.apiKey } : {}),
    };
    this.api.updateOtpSettings(body).subscribe({
      next: (s) => {
        this.busy.set(false);
        this.apiKey = '';
        this.settings.set(s);
        this.toast.success('Enregistré', 'Paramètres OTP mis à jour.');
      },
      error: (err) => {
        this.busy.set(false);
        this.toast.error('Erreur', 'Enregistrement impossible.');
      },
    });
  }
}
