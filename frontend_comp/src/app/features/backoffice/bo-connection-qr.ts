import { Component, inject, signal, OnInit } from '@angular/core';
import { ApiService, ConnectionQr } from '../../core/services/api';
import { ToastService } from '../../core/services/toast';

/**
 * Back-office — Partage du lien de connexion à la plateforme via QR code.
 *
 * Accessible à tous les acteurs internes (agent / superviseur / admin). Le QR
 * code et le lien sont générés par le backend à partir de l'origine du frontend
 * configurée côté serveur. Pratique pour qu'un client rejoigne la plateforme en
 * scannant le code depuis son téléphone, ou pour partager/imprimer le lien.
 */
@Component({
  selector: 'afb-bo-connection-qr',
  imports: [],
  template: `
    <div class="max-w-3xl">
      <div class="mb-6">
        <h1 class="text-xl sm:text-2xl font-bold">Lien de connexion (QR code)</h1>
        <p class="text-sm text-gray-500 max-w-2xl">
          Partagez l'accès à la plateforme : faites scanner ce QR code par un client
          pour l'amener directement sur la page de connexion, ou copiez le lien
          ci-dessous pour le diffuser par un autre canal.
        </p>
      </div>

      <div class="card">
        <div class="card-body flex flex-col items-center gap-5 py-8">
          @if (loading()) {
            <div class="py-16 text-gray-400 text-sm">Génération du QR code…</div>
          } @else if (qr()) {
            <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
              <img [src]="qr()!.qrCodeDataUrl" alt="QR code du lien de connexion"
                   class="w-64 h-64" width="256" height="256">
            </div>

            <div class="w-full max-w-md">
              <label class="label">Lien de connexion</label>
              <div class="flex gap-2">
                <input class="input font-mono text-sm flex-1" [value]="qr()!.url" readonly
                       (focus)="selectAll($event)">
                <button class="btn btn-outline shrink-0" (click)="copy()">Copier</button>
              </div>
            </div>

            <div class="flex gap-2">
              <button class="btn btn-outline" (click)="download()">⬇ Télécharger le QR</button>
              <button class="btn btn-outline" (click)="print()">🖨 Imprimer</button>
              <button class="btn btn-outline" (click)="reload()" [disabled]="loading()">↻ Régénérer</button>
            </div>
          } @else {
            <div class="py-16 text-center">
              <p class="text-gray-400 text-sm mb-3">QR code indisponible.</p>
              <button class="btn btn-outline" (click)="reload()">Réessayer</button>
            </div>
          }
        </div>
      </div>
    </div>
  `,
})
export class BoConnectionQr implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  loading = signal(true);
  qr = signal<ConnectionQr | null>(null);

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.api.getConnectionQr().subscribe({
      next: (r) => {
        this.qr.set(r);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toast.error('Erreur', 'Génération du QR code impossible.');
      },
    });
  }

  selectAll(ev: Event): void {
    (ev.target as HTMLInputElement).select();
  }

  copy(): void {
    const url = this.qr()?.url;
    if (!url) return;
    navigator.clipboard.writeText(url).then(
      () => this.toast.success('Copié', 'Lien de connexion copié dans le presse-papiers.'),
      () => this.toast.error('Erreur', 'Copie impossible.'),
    );
  }

  download(): void {
    const data = this.qr()?.qrCodeDataUrl;
    if (!data) return;
    const a = document.createElement('a');
    a.href = data;
    a.download = 'lien-connexion-qr.png';
    a.click();
  }

  print(): void {
    const data = this.qr()?.qrCodeDataUrl;
    const url = this.qr()?.url;
    if (!data) return;
    const w = window.open('', '_blank');
    if (!w) {
      this.toast.error('Pop-up bloqué', 'Autorisez les fenêtres pour imprimer.');
      return;
    }
    w.document.write(`
      <html><head><title>Lien de connexion</title></head>
      <body style="font-family:sans-serif;text-align:center;padding:40px;">
        <h2>Connexion à la plateforme</h2>
        <img src="${data}" style="width:320px;height:320px;" alt="QR code">
        <p style="font-family:monospace;margin-top:16px;">${url ?? ''}</p>
        <script>window.onload=function(){window.print();}</script>
      </body></html>`);
    w.document.close();
  }
}
