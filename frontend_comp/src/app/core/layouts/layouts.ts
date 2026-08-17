import { Component, computed, inject, signal, OnDestroy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { MockData } from '../services/mock-data';
import { AuthService } from '../services/auth-service';
import { ApiService } from '../services/api';
import { IdleService } from '../services/idle';
import { relativeTime } from '../../shared/time';
import { ChatbotWidget } from './chatbot-widget';
import { ChatService } from '../services/chat-service';

@Component({
  selector: 'afb-public-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ChatbotWidget],
  template: `
    <div class="min-h-screen flex flex-col">
      <header class="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div class="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <a routerLink="/emissions" class="flex items-center gap-3 min-w-0">
            <img src="/Logo_Afriland.png" alt="Afriland First Bond"
                 class="w-10 h-10 rounded-lg object-contain bg-white shrink-0" />
            <div class="min-w-0">
              <div class="font-bold text-gray-900 truncate">Afriland First Bond</div>
              <div class="text-[11px] text-gray-500 truncate">Portail Valeurs du Trésor CEMAC</div>
            </div>
          </a>
          <nav class="hidden md:flex items-center gap-1">
            <a routerLink="/emissions" routerLinkActive="bg-gray-100 text-afb-red" class="px-3 py-2 text-sm rounded-lg hover:bg-gray-100">Émissions</a>
          </nav>
          <div class="flex items-center gap-2 shrink-0">
            <a routerLink="/auth/login" class="btn btn-primary text-sm py-1.5 px-3">Se connecter</a>
          </div>
        </div>
        <nav class="md:hidden border-t border-gray-100 flex justify-around py-1 text-xs">
          <a routerLink="/emissions" routerLinkActive="text-afb-red" class="px-3 py-1.5">Émissions</a>
        </nav>
      </header>
      <main class="flex-1 p-4 sm:p-6 max-w-6xl mx-auto w-full"><router-outlet /></main>
      <footer class="border-t border-gray-200 py-4 text-center text-[11px] sm:text-xs text-gray-500 px-4 bg-white">
        © 2026 Afriland First Bond · Portail Valeurs du Trésor CEMAC
      </footer>
    </div>
    <afb-chatbot-widget />
  `
})
export class PublicLayout {}

@Component({
  selector: 'afb-client-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ChatbotWidget],
  template: `
    @if (idle.warningActive()) {
      <div class="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div class="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full mx-4 text-center">
          <div class="text-5xl mb-4">⏱️</div>
          <h2 class="text-xl font-bold text-gray-900 mb-2">Session inactive</h2>
          <p class="text-gray-500 mb-2">Vous serez déconnecté automatiquement dans</p>
          <p class="text-4xl font-black text-afb-red mb-6">{{ idle.secondsLeft() }}s</p>
          <button class="btn btn-primary w-full" (click)="idle.continueSession()">Continuer la session</button>
        </div>
      </div>
    }
    <div class="min-h-screen flex overflow-x-clip">
      @if (sidebarOpen()) {
        <div class="fixed inset-0 bg-black/50 z-30 lg:hidden" (click)="sidebarOpen.set(false)"></div>
      }
      <aside class="fixed lg:static inset-y-0 left-0 z-40 w-64 bg-white border-r border-gray-200 flex flex-col shadow-xl lg:shadow-none transition-transform duration-200 -translate-x-full lg:translate-x-0"
             [class.!translate-x-0]="sidebarOpen()" [class.lg:hidden]="collapsed()">
        <div class="px-5 py-5 border-b border-gray-100 flex items-center gap-3">
          <img src="/Logo_Afriland.png" alt="Afriland First Bond"
               class="w-9 h-9 rounded-lg object-contain bg-white p-0.5 shrink-0" />
          <div class="min-w-0">
            <div class="text-sm font-bold truncate">First Bond</div>
            <div class="text-[11px] text-gray-500 truncate">Espace Investisseur</div>
          </div>
          <button class="ml-auto lg:hidden text-gray-500 p-1" (click)="sidebarOpen.set(false)">✕</button>
        </div>
        <nav class="flex-1 p-3 space-y-1 overflow-y-auto">
          <a routerLink="/client/dashboard" routerLinkActive="active" class="sidebar-link" (click)="close()"><span>Tableau de bord</span></a>
          <a routerLink="/client/emissions" routerLinkActive="active" class="sidebar-link" (click)="close()"><span>Émissions</span></a>
          <a routerLink="/client/orders" routerLinkActive="active" class="sidebar-link" (click)="close()"><span>Mes ordres</span></a>
          @if (compteJoint()) {
            <a routerLink="/client/validations" routerLinkActive="active" class="sidebar-link flex items-center justify-between" (click)="close()">
              <span>Validations</span>
              @if (cosignCount() > 0) {
                <span class="bg-afb-red text-white text-[10px] rounded-full min-w-4 h-4 px-1 grid place-items-center">{{ cosignCount() }}</span>
              }
            </a>
          }
          <a routerLink="/client/portfolio" routerLinkActive="active" class="sidebar-link" (click)="close()"><span>Portefeuille</span></a>
          <a routerLink="/client/documents" routerLinkActive="active" class="sidebar-link" (click)="close()"><span>Documents</span></a>
          <a routerLink="/client/notifications" routerLinkActive="active" class="sidebar-link" (click)="close()"><span>Notifications</span></a>
          <a routerLink="/client/messagerie" routerLinkActive="active" class="sidebar-link flex items-center justify-between" (click)="close()">
            <span>Messagerie</span>
            @if (chatUnread() > 0) {
              <span class="bg-afb-red text-white text-[10px] rounded-full min-w-4 h-4 px-1 grid place-items-center">{{ chatUnread() }}</span>
            }
          </a>
        </nav>
      </aside>
      <div class="flex-1 flex flex-col min-w-0 min-h-0">
        <header class="bg-white border-b border-gray-200 h-14 sm:h-16 flex items-center justify-between px-3 sm:px-6 gap-2 shrink-0">
          <div class="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <button class="lg:hidden text-gray-600 hover:text-afb-red text-xl p-1 shrink-0" (click)="sidebarOpen.set(true)" aria-label="Ouvrir le menu">☰</button>
            <button class="hidden lg:inline-flex text-gray-600 hover:text-afb-red text-xl p-1 shrink-0"
                    (click)="collapsed.set(!collapsed())"
                    [title]="collapsed() ? 'Afficher le menu' : 'Réduire le menu'"
                    [attr.aria-label]="collapsed() ? 'Afficher le menu' : 'Réduire le menu'">{{ collapsed() ? '☰' : '«' }}</button>
            <div class="min-w-0 hidden sm:block">
              <div class="text-xs sm:text-sm font-semibold text-gray-900 truncate">{{ user().prenom }} {{ user().nom }}</div>
              <div class="text-[11px] text-gray-500 truncate">
                @if (user().telephone) { <span>{{ user().telephone }} · </span> }
                <span class="font-mono">{{ user().compteTitres }}</span>
              </div>
            </div>
            <div class="text-sm font-semibold sm:hidden truncate">{{ user().prenom }} {{ user().nom }}</div>
          </div>
          <div class="flex items-center gap-2 sm:gap-4 shrink-0">
            <div class="relative">
              <button class="relative text-gray-600 hover:text-afb-red text-lg p-1" (click)="toggleNotif($event)" aria-label="Notifications">🔔
                @if (unread() > 0) {
                  <span class="absolute -top-0.5 -right-0.5 bg-afb-red text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 grid place-items-center">{{ unread() > 9 ? '9+' : unread() }}</span>
                }
              </button>
              @if (notifOpen()) {
                <div class="fixed inset-0 z-40" (click)="notifOpen.set(false)"></div>
                <div class="absolute right-0 mt-2 w-80 sm:w-96 max-h-[70vh] rounded-xl border border-gray-200 bg-white shadow-xl z-50 flex flex-col overflow-hidden">
                  <div class="flex items-center justify-between px-4 py-3 border-b">
                    <div class="font-semibold text-sm">Notifications @if (unread() > 0) { <span class="text-afb-red">({{ unread() }})</span> }</div>
                    @if (unread() > 0) {
                      <button class="text-[11px] text-afb-red font-medium hover:underline" (click)="markAllReadFromBell($event)">Tout marquer lu</button>
                    }
                  </div>
                  <div class="overflow-y-auto divide-y divide-gray-100">
                    @for (n of recentNotifs(); track n.id) {
                      <button class="w-full text-left px-4 py-3 flex gap-2.5 hover:bg-gray-50 transition" (click)="openNotif(n)">
                        <span class="shrink-0 w-2 h-2 mt-1.5 rounded-full" [class.bg-afb-red]="!n.lu"></span>
                        <span class="flex-1 min-w-0">
                          <span class="flex items-baseline justify-between gap-2">
                            <span class="text-sm truncate" [class.font-semibold]="!n.lu">{{ notifIcon(n.type) }} {{ n.titre }}</span>
                            <span class="text-[10px] text-gray-400 shrink-0">{{ rel(n.date) }}</span>
                          </span>
                          <span class="block text-xs text-gray-500 truncate">{{ n.message }}</span>
                        </span>
                      </button>
                    }
                    @if (!recentNotifs().length) {
                      <div class="px-4 py-10 text-center text-gray-400 text-sm">📭 Aucune notification</div>
                    }
                  </div>
                  <a routerLink="/client/notifications" (click)="notifOpen.set(false)"
                     class="block text-center text-sm text-afb-red font-medium px-4 py-2.5 border-t hover:bg-gray-50">Voir toutes les notifications</a>
                </div>
              }
            </div>
            <div class="relative">
              <button class="flex items-center gap-2 rounded-full hover:bg-gray-100 p-1 pr-2 transition"
                      (click)="toggleProfile($event)" aria-label="Menu du profil">
                <span class="w-9 h-9 rounded-full bg-afb-red-light text-afb-red grid place-items-center font-bold shrink-0">{{ initials() }}</span>
                <span class="text-right hidden md:block leading-tight">
                  <span class="block text-sm font-semibold truncate max-w-[160px]">{{ user().prenom }} {{ user().nom }}</span>
                  <span class="block text-[11px] text-gray-500 truncate max-w-[160px]">{{ user().email }}</span>
                </span>
                <span class="text-gray-400 text-xs hidden sm:inline">▾</span>
              </button>
              @if (profileOpen()) {
                <div class="fixed inset-0 z-40" (click)="profileOpen.set(false)"></div>
                <div class="absolute right-0 mt-2 w-64 rounded-xl border border-gray-200 bg-white shadow-xl z-50 overflow-hidden">
                  <div class="px-4 py-3 border-b">
                    <div class="font-semibold text-sm truncate">{{ user().prenom }} {{ user().nom }}</div>
                    <div class="text-xs text-gray-500 truncate">{{ user().email }}</div>
                    @if (user().compteTitres) {
                      <div class="text-[11px] text-gray-400 font-mono mt-0.5 truncate">{{ user().compteTitres }}</div>
                    }
                  </div>
                  <a routerLink="/client/profile" (click)="profileOpen.set(false)"
                     class="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-gray-50">👤 Mon compte</a>
                  <button (click)="logout()"
                          class="flex items-center gap-2 w-full text-left px-4 py-2.5 text-sm text-afb-red hover:bg-gray-50 border-t">
                    ⎋ Se déconnecter
                  </button>
                </div>
              }
            </div>
          </div>
        </header>
        <main class="flex-1 min-h-0 p-3 sm:p-4 md:p-6 overflow-y-auto overflow-x-hidden"><router-outlet /></main>
      </div>
    </div>
    <afb-chatbot-widget />
  `
})
export class ClientLayout implements OnDestroy {
  private readonly router = inject(Router);
  private readonly data = inject(MockData);
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly chat = inject(ChatService);
  private readonly platformId = inject(PLATFORM_ID);
  readonly idle = inject(IdleService);
  user = this.data.currentUser;
  unread = computed(() => this.data.notifications().filter(n => !n.lu).length);
  /** Messages non lus du fil de discussion avec la banque — badge du menu Messagerie. */
  chatUnread = signal(0);
  private readonly chatPoll: ReturnType<typeof setInterval> | null = null;
  /** Panneau de notifications (cloche) — 6 plus recentes. */
  notifOpen = signal(false);
  /** Menu déroulant du profil (en haut à droite). */
  profileOpen = signal(false);
  toggleProfile(ev: Event) { ev.stopPropagation(); this.profileOpen.set(!this.profileOpen()); this.notifOpen.set(false); }
  recentNotifs = computed(() => this.data.notifications().slice(0, 6));
  /**
   * Le menu « Validations » n'a de sens que pour un compte à plusieurs
   * signataires. Le drapeau vient du serveur : un co-signataire ne porte pas de
   * `typeCompte`, on ne peut donc pas le déduire ici.
   */
  compteJoint = computed(() => this.user().compteJoint === true);
  /** Nb d'operations (compte joint) en attente de MA signature — badge du menu. */
  cosignCount = signal(0);
  private readonly cosignPoll: ReturnType<typeof setInterval> | null = null;
  sidebarOpen = signal(false);
  /** Réduction du menu latéral sur grand écran (affichage plein largeur). */
  collapsed = signal(false);
  initials() { const u = this.user(); return (u.prenom?.[0] ?? '') + (u.nom?.[0] ?? ''); }
  close() { this.sidebarOpen.set(false); }
  logout() { this.auth.logout().subscribe(() => this.router.navigate(['/auth/login'])); }

  // ── Cloche de notifications ──
  rel(d: string) { return relativeTime(d); }
  notifIcon(t: string) {
    return ({ INFO: 'ℹ️', SUCCESS: '✅', WARN: '⚠️', ERROR: '❌' } as Record<string, string>)[t] ?? '🔔';
  }
  toggleNotif(ev: Event) {
    ev.stopPropagation();
    const open = !this.notifOpen();
    this.notifOpen.set(open);
    if (open) this.data.refreshNotifications();
  }
  markAllReadFromBell(ev: Event) { ev.stopPropagation(); this.data.markAllNotificationsRead(); }
  openNotif(n: { id: string; lu: boolean }) {
    if (!n.lu) this.data.markNotificationRead(n.id);
    this.notifOpen.set(false);
    this.router.navigate(['/client/notifications']);
  }

  /** Rafraichit le compteur de validations en attente (compte joint). */
  private refreshCosign() {
    this.api.listPendingCoSignatures().subscribe({
      next: list => this.cosignCount.set((list ?? []).length),
      error: () => { /* ignore : badge purement indicatif */ },
    });
  }
  /** Rafraichit le compteur de messages non lus du fil de discussion. */
  private refreshChatUnread() {
    this.chat.myConversation().subscribe({
      next: conv => this.chatUnread.set(conv.unread ?? 0),
      error: () => { /* ignore : badge purement indicatif */ },
    });
  }
  constructor() {
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => {
      this.sidebarOpen.set(false);
      this.refreshCosign();
    });
    if (isPlatformBrowser(this.platformId)) {
      this.refreshCosign();
      // Poll regulier : une demande de signature peut arriver pendant la session
      // (TTL co-signature = 5 min, donc 45 s reste largement assez réactif).
      this.cosignPoll = setInterval(() => this.refreshCosign(), 45_000);
      this.refreshChatUnread();
      this.chatPoll = setInterval(() => this.refreshChatUnread(), 20_000);
      this.idle.start();
    }
  }
  ngOnDestroy(): void {
    if (this.cosignPoll) clearInterval(this.cosignPoll);
    if (this.chatPoll) clearInterval(this.chatPoll);
    this.idle.stop();
  }
}

@Component({
  selector: 'afb-backoffice-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ChatbotWidget],
  template: `
    @if (idle.warningActive()) {
      <div class="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div class="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full mx-4 text-center">
          <div class="text-5xl mb-4">⏱️</div>
          <h2 class="text-xl font-bold text-gray-900 mb-2">Session inactive</h2>
          <p class="text-gray-500 mb-2">Vous serez déconnecté automatiquement dans</p>
          <p class="text-4xl font-black text-afb-red mb-6">{{ idle.secondsLeft() }}s</p>
          <button class="btn btn-primary w-full" (click)="idle.continueSession()">Continuer la session</button>
        </div>
      </div>
    }
    <div class="min-h-screen flex overflow-x-clip">
      @if (sidebarOpen()) {
        <div class="fixed inset-0 bg-black/50 z-30 lg:hidden" (click)="sidebarOpen.set(false)"></div>
      }
      <aside class="fixed lg:static inset-y-0 left-0 z-40 w-64 bg-gray-900 text-gray-200 flex flex-col shadow-xl lg:shadow-none transition-transform duration-200 -translate-x-full lg:translate-x-0"
             [class.!translate-x-0]="sidebarOpen()" [class.lg:hidden]="collapsed()">
        <div class="px-5 py-5 border-b border-white/10 flex items-center gap-3">
          <img src="/Logo_Afriland.png" alt="Afriland First Bond"
               class="w-9 h-9 rounded-lg object-contain bg-white p-0.5 shrink-0" />
          <div class="min-w-0 flex-1">
            <div class="text-sm font-bold truncate">First Bond</div>
            <div class="text-[11px] text-gray-400 truncate">{{ roleLabel() }}</div>
          </div>
          <button class="lg:hidden text-gray-400 p-1" (click)="sidebarOpen.set(false)">✕</button>
        </div>
        <nav class="flex-1 p-3 space-y-1 text-sm overflow-y-auto">
          <a routerLink="/backoffice/dashboard" routerLinkActive="!bg-afb-red !text-white" class="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/10" (click)="close()">Tableau de bord</a>
          <a routerLink="/backoffice/discussions" routerLinkActive="!bg-afb-red !text-white" class="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg hover:bg-white/10" (click)="close()">
            <span>Discussions</span>
            @if (chatUnread() > 0) {
              <span class="bg-afb-red text-white text-[10px] rounded-full min-w-4 h-4 px-1 grid place-items-center">{{ chatUnread() }}</span>
            }
          </a>
          <a routerLink="/backoffice/rapports" routerLinkActive="!bg-afb-red !text-white" class="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/10" (click)="close()">Rapports et analyses</a>
          <a routerLink="/backoffice/emissions" routerLinkActive="!bg-afb-red !text-white" class="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/10" (click)="close()">Émissions</a>
          @if (canOps()) {
            <a routerLink="/backoffice/orders" routerLinkActive="!bg-afb-red !text-white" class="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/10" (click)="close()">Ordres collectés</a>
            <a routerLink="/backoffice/livrables" routerLinkActive="!bg-afb-red !text-white" class="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/10" (click)="close()">Livrables</a>
          }
          @if (canManageClients()) {
            <a routerLink="/backoffice/clients" routerLinkActive="!bg-afb-red !text-white" class="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/10" (click)="close()">Clients</a>
            <a routerLink="/backoffice/inscriptions" routerLinkActive="!bg-afb-red !text-white" class="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/10" (click)="close()">Vérifications faciales</a>
            <a routerLink="/backoffice/base-clients" routerLinkActive="!bg-afb-red !text-white" class="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/10" (click)="close()">Base clients</a>
            <a routerLink="/backoffice/import-portefeuille" routerLinkActive="!bg-afb-red !text-white" class="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/10" (click)="close()">Import portefeuille</a>
          }
          <a routerLink="/backoffice/otp-log" routerLinkActive="!bg-afb-red !text-white" class="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/10" (click)="close()">Codes OTP</a>
          <a routerLink="/backoffice/connection-qr" routerLinkActive="!bg-afb-red !text-white" class="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/10" (click)="close()">Lien de connexion (QR)</a>
          @if (isAdmin() || canAudit()) {
            <div class="pt-3 mt-3 border-t border-white/10 text-[11px] uppercase text-gray-400 px-3">Administration</div>
            @if (isAdmin()) {
              <a routerLink="/backoffice/users" routerLinkActive="!bg-afb-red !text-white" class="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/10" (click)="close()">Utilisateurs</a>
              <a routerLink="/backoffice/messagerie" routerLinkActive="!bg-afb-red !text-white" class="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/10" (click)="close()">Messagerie</a>
              <a routerLink="/backoffice/signatures" routerLinkActive="!bg-afb-red !text-white" class="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/10" (click)="close()">Signatures dirigeants</a>
              <a routerLink="/backoffice/otp" routerLinkActive="!bg-afb-red !text-white" class="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/10" (click)="close()">Serveur OTP</a>
              <a routerLink="/backoffice/ldap" routerLinkActive="!bg-afb-red !text-white" class="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/10" (click)="close()">LDAP / Active Directory</a>
            }
            @if (canAudit()) {
              <a routerLink="/backoffice/audit" routerLinkActive="!bg-afb-red !text-white" class="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/10" (click)="close()">Journal d'audit</a>
            }
          }
        </nav>
        <div class="p-3 border-t border-white/10">
          <button (click)="logout()" class="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/10 w-full text-sm">Se déconnecter</button>
        </div>
      </aside>
      <div class="flex-1 flex flex-col min-w-0 min-h-0">
        <header class="bg-white border-b border-gray-200 h-14 sm:h-16 flex items-center justify-between px-3 sm:px-6 gap-2 shrink-0">
          <div class="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <button class="lg:hidden text-gray-600 hover:text-afb-red text-xl p-1 shrink-0" (click)="sidebarOpen.set(true)" aria-label="Ouvrir le menu">☰</button>
            <button class="hidden lg:inline-flex text-gray-600 hover:text-afb-red text-xl p-1 shrink-0"
                    (click)="collapsed.set(!collapsed())"
                    [title]="collapsed() ? 'Afficher le menu' : 'Réduire le menu'"
                    [attr.aria-label]="collapsed() ? 'Afficher le menu' : 'Réduire le menu'">{{ collapsed() ? '☰' : '«' }}</button>
            <div class="text-xs sm:text-sm text-gray-600 truncate min-w-0">
              <span class="font-semibold text-gray-900">{{ user().prenom }} {{ user().nom }}</span>
              <span class="hidden md:inline text-gray-500"> · {{ roleLabel() }}</span>
            </div>
          </div>
          <div class="flex items-center gap-1.5 sm:gap-3 shrink-0">
            <div class="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-gray-900 text-white grid place-items-center font-bold text-xs sm:text-sm">{{ initials() }}</div>
          </div>
        </header>
        <main class="flex-1 min-h-0 p-3 sm:p-4 md:p-6 overflow-y-auto overflow-x-hidden"><router-outlet /></main>
      </div>
    </div>
    <afb-chatbot-widget />
  `
})
export class BackofficeLayout implements OnDestroy {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly data = inject(MockData);
  private readonly chat = inject(ChatService);
  private readonly platformId = inject(PLATFORM_ID);
  readonly idle = inject(IdleService);
  /** Poll de rafraichissement de la matrice RBAC (mise a jour immediate du menu). */
  private readonly permPoll: ReturnType<typeof setInterval> | null = null;
  private readonly chatPoll: ReturnType<typeof setInterval> | null = null;
  /** Total des messages non lus, tous fils de discussion confondus — badge du menu Discussions. */
  chatUnread = signal(0);
  user = this.data.currentUser;
  sidebarOpen = signal(false);
  /** Réduction du menu latéral sur grand écran (affichage plein largeur). */
  collapsed = signal(false);
  /** Le journal d'audit est réservé à l'administrateur (permission AUDIT_READ). */
  canAudit = computed(() => this.data.hasPermission('AUDIT_READ'));
  /** Opérations courantes (ordres, livrables) — agent et superviseur. */
  canOps = computed(() => this.data.hasPermission('ORDER_VALIDATE')
    || this.data.hasPermission('ORDER_RESULT_VALIDATE'));
  /** Gestion des comptes clients (permission CLIENT_MANAGE). */
  canManageClients = computed(() => this.data.hasPermission('CLIENT_MANAGE'));
  /** Espace d'administration (utilisateurs, messagerie, OTP, audit) — admin uniquement. */
  isAdmin = computed(() => this.data.currentUser().role === 'ADMIN');
  /** Libellé du profil affiché en clair (sans jargon technique). */
  roleLabel = computed(() => ({
    AGENT: 'Espace Agent',
    SUPERVISEUR: 'Espace Superviseur',
    ADMIN: 'Espace Administrateur',
  } as Record<string, string>)[this.data.currentUser().role] ?? 'Back-Office');
  initials() { const u = this.user(); return (u.prenom?.[0] ?? '') + (u.nom?.[0] ?? ''); }
  close() { this.sidebarOpen.set(false); }
  logout() { this.auth.logout().subscribe(() => this.router.navigate(['/auth/login'])); }
  /** Rafraichit le total de messages non lus, tous fils de discussion confondus. */
  private refreshChatUnread() {
    this.chat.listConversations().subscribe({
      next: list => this.chatUnread.set((list ?? []).reduce((sum, c) => sum + c.unread, 0)),
      error: () => { /* ignore : badge purement indicatif */ },
    });
  }
  constructor() {
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => {
      this.sidebarOpen.set(false);
      // Rafraichit les permissions a chaque navigation : un changement de matrice
      // RBAC cote admin se reflete des que l'utilisateur change de page.
      this.data.refreshPermissions();
    });
    // ... et periodiquement, pour que la modification d'un role s'applique
    // immediatement aux sessions ouvertes (menus/guards bases sur les permissions)
    // sans attendre une navigation ni un rechargement de page.
    if (isPlatformBrowser(this.platformId)) {
      this.data.refreshPermissions();
      // Les permissions sont déjà rafraîchies à CHAQUE navigation (ci-dessus) ;
      // ce filet périodique est espacé (2 min) pour ne pas marteler le réseau ni
      // déclencher une détection de changement toutes les 12 s.
      this.permPoll = setInterval(() => this.data.refreshPermissions(), 120_000);
      this.refreshChatUnread();
      this.chatPoll = setInterval(() => this.refreshChatUnread(), 20_000);
      this.idle.start();
    }
  }

  ngOnDestroy(): void {
    if (this.permPoll) clearInterval(this.permPoll);
    if (this.chatPoll) clearInterval(this.chatPoll);
    this.idle.stop();
  }
}
