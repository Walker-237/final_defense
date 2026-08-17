import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, OtpLogEntry } from '../../core/services/api';
import { ToastService } from '../../core/services/toast';
import { Paginator, PaginatePipe } from '../../shared/pagination';

/**
 * Back-office — Supervision des codes OTP.
 *
 * Permet au back-office (agent / superviseur / admin) de consulter le code de
 * vérification envoyé à un utilisateur ou un client, afin de le relayer par un
 * autre moyen en cas de non-réception (ou de le communiquer si le client est
 * présent à l'agence).
 *
 * Le code en clair n'est utilisé que pour cet affichage ; la vérification reste
 * basée sur une empreinte. Chaque consultation est tracée dans le journal d'audit.
 */
@Component({
  selector: 'afb-bo-otp-log',
  imports: [FormsModule, Paginator, PaginatePipe],
  template: `
    <div class="max-w-5xl">
      <div class="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 class="text-xl sm:text-2xl font-bold">Supervision des codes OTP</h1>
          <p class="text-sm text-gray-500 max-w-2xl">
            Codes de vérification envoyés aux utilisateurs et aux clients. En cas de
            non-réception, communiquez le code actif au client par un autre canal
            (ou de vive voix s'il est présent).
          </p>
        </div>
        <button class="btn btn-outline shrink-0" (click)="reload()" [disabled]="loading()">
          {{ loading() ? 'Chargement…' : '↻ Rafraîchir' }}
        </button>
      </div>

      <div class="card mb-4">
        <div class="card-body flex flex-col sm:flex-row gap-3 sm:items-end">
          <div class="flex-1">
            <label class="label">Rechercher</label>
            <input class="input" [(ngModel)]="q" name="q" (keyup.enter)="reload()"
                   placeholder="E-mail, nom ou téléphone…">
          </div>
          <label class="flex items-center gap-2 text-sm text-gray-700 pb-2">
            <input type="checkbox" [(ngModel)]="activeOnly" name="activeOnly" (change)="reload()">
            Codes actifs uniquement
          </label>
          <button class="btn btn-primary" (click)="reload()" [disabled]="loading()">Rechercher</button>
        </div>
      </div>

      @if (loading()) {
        <div class="card p-8 text-center text-gray-400 text-sm">Chargement…</div>
      } @else if (entries().length === 0) {
        <div class="card p-8 text-center text-gray-400 text-sm">Aucun code à afficher.</div>
      } @else {
        <div class="card overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 text-gray-600 text-left">
              <tr>
                <th class="px-4 py-3 font-semibold">Destinataire</th>
                <th class="px-4 py-3 font-semibold">Téléphone</th>
                <th class="px-4 py-3 font-semibold">Code</th>
                <th class="px-4 py-3 font-semibold">Statut</th>
                <th class="px-4 py-3 font-semibold">Envoyé le</th>
                <th class="px-4 py-3 font-semibold">Expire à</th>
                <th class="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              @for (e of (entries() | paginate:page():25); track e.id) {
                <tr [class.bg-emerald-50]="e.active">
                  <td class="px-4 py-3">
                    <div class="font-medium text-gray-900">{{ e.utilisateurNom }}</div>
                    <div class="text-[12px] text-gray-500">{{ e.email }}</div>
                    <span class="badge bg-gray-100 text-gray-600 text-[10px] mt-0.5">{{ roleLabel(e.role) }}</span>
                  </td>
                  <td class="px-4 py-3 whitespace-nowrap">{{ e.telephone || '—' }}</td>
                  <td class="px-4 py-3">
                    <span class="font-mono text-lg font-bold tracking-widest"
                          [class.text-gray-400]="!e.active">{{ e.code || '—' }}</span>
                  </td>
                  <td class="px-4 py-3">
                    @if (e.active) {
                      <span class="badge bg-emerald-100 text-emerald-700">● Actif</span>
                    } @else if (e.consumed) {
                      <span class="badge bg-gray-100 text-gray-500">Utilisé</span>
                    } @else {
                      <span class="badge bg-amber-100 text-amber-700">Expiré</span>
                    }
                  </td>
                  <td class="px-4 py-3 whitespace-nowrap text-gray-600">{{ fmtDate(e.createdAt) }}</td>
                  <td class="px-4 py-3 whitespace-nowrap text-gray-600">{{ fmtDate(e.expiresAt) }}</td>
                  <td class="px-4 py-3 text-right">
                    @if (e.code) {
                      <button class="btn btn-outline py-1 px-2 text-xs" (click)="copy(e.code)">Copier</button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <afb-paginator [total]="entries().length" [pageSize]="25" [(page)]="page" />
        <p class="text-[11px] text-gray-400 mt-3 leading-relaxed">
          • Affichage réservé au back-office · chaque consultation est journalisée (audit).<br/>
          • Communiquez le code uniquement à la personne dûment identifiée.
        </p>
      }
    </div>
  `,
})
export class BoOtpLog {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  loading = signal(true);
  entries = signal<OtpLogEntry[]>([]);
  page = signal(1);
  q = '';
  activeOnly = false;

  private readonly roles: Record<string, string> = {
    CLIENT_PP: 'Client (PP)', CLIENT_PM: 'Client (PM)',
    AGENT: 'Agent', SUPERVISEUR: 'Superviseur', ADMIN: 'Administrateur',
  };

  constructor() {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.page.set(1);
    this.api.getOtpLog(this.q, this.activeOnly).subscribe({
      next: (p) => {
        this.entries.set(p.data);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.toast.error('Erreur', 'Chargement impossible.');
      },
    });
  }

  roleLabel(role: string): string {
    return this.roles[role] ?? role;
  }

  fmtDate(iso?: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('fr-FR');
  }

  copy(code?: string): void {
    if (!code || typeof navigator === 'undefined' || !navigator.clipboard) return;
    navigator.clipboard.writeText(code)
      .then(() => this.toast.success('Copié', 'Code copié dans le presse-papiers.'))
      .catch(() => {});
  }
}
