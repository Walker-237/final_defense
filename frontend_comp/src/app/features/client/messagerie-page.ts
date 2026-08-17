import { Component, ElementRef, OnDestroy, ViewChild, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChatService } from '../../core/services/chat-service';
import { MockData } from '../../core/services/mock-data';

/**
 * Espace investisseur — Messagerie en direct avec un conseiller Afriland First Bank.
 *
 * Un client dispose d'un fil de discussion persistant unique ; le premier
 * membre du back-office qui répond devient son interlocuteur assigné.
 */
@Component({
  selector: 'afb-messagerie',
  imports: [FormsModule],
  template: `
    <div class="flex flex-col h-full">
      <div class="mb-4">
        <h1 class="text-xl sm:text-2xl font-bold">Messagerie</h1>
        <p class="text-sm text-gray-500">Discutez en direct avec un conseiller Afriland First Bank.</p>
      </div>

      <div class="card flex-1 min-h-0 flex flex-col overflow-hidden">
        <div class="px-4 py-3 border-b border-gray-100 flex items-center gap-2 shrink-0">
          <span class="w-2 h-2 rounded-full" [class.bg-emerald-500]="chat.connected()" [class.bg-gray-300]="!chat.connected()"></span>
          <span class="text-xs text-gray-500">{{ chat.connected() ? 'Connecté' : 'Connexion…' }}</span>
        </div>

        <div #scrollArea class="flex-1 overflow-y-auto px-4 py-4 space-y-2.5 bg-gray-50">
          @if (!chat.messages().length) {
            <div class="text-center text-gray-400 text-sm py-10">
              Aucun message pour l'instant. Posez votre question, un conseiller vous répondra.
            </div>
          }
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
                 [(ngModel)]="draft" name="draft" placeholder="Écrivez votre message…" autocomplete="off" />
          <button type="submit" class="w-10 h-10 rounded-full bg-afb-red text-white grid place-items-center shrink-0 disabled:opacity-40"
                  [disabled]="!draft.trim()" aria-label="Envoyer">➤</button>
        </form>
      </div>
    </div>
  `,
})
export class MessageriePage implements OnDestroy {
  readonly chat = inject(ChatService);
  private readonly data = inject(MockData);

  @ViewChild('scrollArea') private scrollArea?: ElementRef<HTMLDivElement>;

  draft = '';

  constructor() {
    this.chat.myConversation().subscribe((conv) => {
      this.chat.connect(conv.id);
      if (conv.unread > 0) {
        this.chat.markRead(conv.id).subscribe();
      }
    });
    effect(() => {
      this.chat.messages();
      this.scrollSoon();
    });
  }

  isMine(senderId: string): boolean {
    return senderId === this.data.currentUser().id;
  }

  send(): void {
    if (!this.draft.trim()) return;
    this.chat.send(this.draft);
    this.draft = '';
  }

  ngOnDestroy(): void {
    this.chat.disconnect();
  }

  private scrollSoon(): void {
    setTimeout(() => {
      const el = this.scrollArea?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}
