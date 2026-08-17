import { Component, ElementRef, OnDestroy, PLATFORM_ID, ViewChild, effect, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatService, ConversationSummary } from '../../core/services/chat-service';
import { MockData } from '../../core/services/mock-data';
import { relativeTime } from '../../shared/time';

/**
 * Back-office — Discussions en direct avec les clients.
 *
 * Liste de tous les fils de discussion à gauche, échange en temps réel à
 * droite. Le premier membre du back-office qui répond à un fil non assigné
 * en devient l'interlocuteur (auto-affectation côté serveur).
 */
@Component({
  selector: 'afb-bo-discussions',
  imports: [FormsModule],
  template: `
    <div class="flex flex-col h-full">
      <div class="mb-4">
        <h1 class="text-xl sm:text-2xl font-bold">Discussions</h1>
        <p class="text-sm text-gray-500">Messagerie en direct avec les clients.</p>
      </div>

      <div class="card flex-1 min-h-0 flex overflow-hidden">
        <!-- Liste des fils : cachee sur mobile des qu'un fil est ouvert, toujours visible a partir de sm. -->
        <div class="w-full sm:w-80 shrink-0 border-r border-gray-100 flex-col sm:flex"
             [class.hidden]="!!selected()" [class.flex]="!selected()">
          <div class="overflow-y-auto divide-y divide-gray-100 flex-1">
            @if (loading()) {
              <div class="p-6 text-center text-gray-400 text-sm">Chargement…</div>
            } @else if (!conversations().length) {
              <div class="p-6 text-center text-gray-400 text-sm">Aucune discussion.</div>
            }
            @for (c of conversations(); track c.id) {
              <button class="w-full text-left px-4 py-3 hover:bg-gray-50 transition"
                      [class.bg-gray-100]="selected()?.id === c.id"
                      (click)="open(c)">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-sm font-semibold truncate">{{ c.clientPrenom }} {{ c.clientNom }}</span>
                  @if (c.unread > 0) {
                    <span class="bg-afb-red text-white text-[10px] rounded-full min-w-[18px] h-[18px] px-1 grid place-items-center shrink-0">{{ c.unread }}</span>
                  }
                </div>
                <div class="text-xs text-gray-500 truncate mt-0.5">{{ c.dernierMessage || 'Aucun message' }}</div>
                <div class="text-[10px] text-gray-400 mt-0.5">{{ rel(c.updatedAt) }}</div>
              </button>
            }
          </div>
        </div>

        <!-- Fil actif : visible sur mobile uniquement quand un fil est ouvert. -->
        <div class="flex-1 min-w-0 flex-col sm:flex" [class.hidden]="!selected()" [class.flex]="!!selected()">
          @if (!selected()) {
            <div class="flex-1 grid place-items-center text-gray-400 text-sm">
              Sélectionnez une discussion.
            </div>
          } @else {
            <div class="px-4 py-3 border-b border-gray-100 flex items-center gap-2 shrink-0">
              <button class="sm:hidden text-gray-500 mr-1" (click)="selected.set(null)" aria-label="Retour">←</button>
              <div class="min-w-0 flex-1">
                <div class="text-sm font-semibold truncate">{{ selected()!.clientPrenom }} {{ selected()!.clientNom }}</div>
              </div>
              <span class="w-2 h-2 rounded-full" [class.bg-emerald-500]="chat.connected()" [class.bg-gray-300]="!chat.connected()"></span>
            </div>

            <div #scrollArea class="flex-1 overflow-y-auto px-4 py-4 space-y-2.5 bg-gray-50">
              @for (m of chat.messages(); track m.id) {
                <div class="flex" [class.justify-end]="isMine(m.senderId)">
                  <div class="max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap break-words"
                       [class.bg-afb-red]="isMine(m.senderId)"
                       [class.text-white]="isMine(m.senderId)"
                       [class.rounded-tr-sm]="isMine(m.senderId)"
                       [class.bg-white]="!isMine(m.senderId)"
                       [class.border]="!isMine(m.senderId)"
                       [class.border-gray-200]="!isMine(m.senderId)"
                       [class.text-gray-700]="!isMine(m.senderId)"
                       [class.rounded-tl-sm]="!isMine(m.senderId)">
                    {{ m.contenu }}
                  </div>
                </div>
              }
            </div>

            <form class="flex items-center gap-2 p-3 border-t border-gray-100 shrink-0" (ngSubmit)="send()">
              <input class="flex-1 text-sm rounded-full border border-gray-200 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-afb-red/30"
                     [(ngModel)]="draft" name="draft" placeholder="Répondre…" autocomplete="off" />
              <button type="submit" class="w-10 h-10 rounded-full bg-afb-red text-white grid place-items-center shrink-0 disabled:opacity-40"
                      [disabled]="!draft.trim()" aria-label="Envoyer">➤</button>
            </form>
          }
        </div>
      </div>
    </div>
  `,
})
export class BoDiscussions implements OnDestroy {
  readonly chat = inject(ChatService);
  private readonly data = inject(MockData);
  private readonly platformId = inject(PLATFORM_ID);

  @ViewChild('scrollArea') private scrollArea?: ElementRef<HTMLDivElement>;

  conversations = signal<ConversationSummary[]>([]);
  selected = signal<ConversationSummary | null>(null);
  loading = signal(true);
  draft = '';

  private poll: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.load();
    if (isPlatformBrowser(this.platformId)) {
      this.poll = setInterval(() => this.load(), 15_000);
    }
    effect(() => {
      this.chat.messages();
      this.scrollSoon();
    });
  }

  isMine(senderId: string): boolean {
    return senderId === this.data.currentUser().id;
  }

  rel(d: string): string {
    return relativeTime(d);
  }

  load(): void {
    this.chat.listConversations().subscribe({
      next: (list) => { this.conversations.set(list ?? []); this.loading.set(false); },
      error: () => { this.loading.set(false); },
    });
  }

  open(c: ConversationSummary): void {
    this.selected.set(c);
    this.chat.connect(c.id);
    if (c.unread > 0) {
      this.chat.markRead(c.id).subscribe(() => this.load());
    }
  }

  send(): void {
    if (!this.draft.trim()) return;
    this.chat.send(this.draft);
    this.draft = '';
  }

  ngOnDestroy(): void {
    if (this.poll) clearInterval(this.poll);
    this.chat.disconnect();
  }

  private scrollSoon(): void {
    setTimeout(() => {
      const el = this.scrollArea?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}
