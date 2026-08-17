import { Component, ElementRef, PLATFORM_ID, ViewChild, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, ChatMessage as ChatMessageDto } from '../services/api';
import { ChatMessage as ChatMessageView } from '../../shared/chat-message';

/** Bulle flottante d'assistant conversationnel, visible sur les espaces authentifiés. */
@Component({
  selector: 'afb-chatbot-widget',
  imports: [FormsModule, ChatMessageView],
  template: `
    <div class="fixed bottom-5 right-5 z-[45]">
      @if (open()) {
        <div class="mb-3 w-[22rem] max-w-[calc(100vw-2.5rem)] h-[28rem] max-h-[70vh] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
          <div class="flex items-center justify-between px-4 py-3 border-b bg-afb-red text-white shrink-0">
            <div class="flex items-center gap-2 min-w-0">
              <img src="/AI_mascot.png" alt="Assistant IA" class="w-8 h-8 rounded-full object-contain bg-white shrink-0" />
              <div class="min-w-0">
                <div class="text-sm font-semibold truncate">Assistant First Bond</div>
                <div class="text-[10px] text-white/80 truncate">Questions sur la plateforme</div>
              </div>
            </div>
            <button class="text-white/80 hover:text-white text-sm" (click)="toggle()" aria-label="Fermer l'assistant">✕</button>
          </div>
          <div #scrollArea class="flex-1 overflow-y-auto px-3 py-3 space-y-2.5 bg-gray-50">
            @if (!messages().length) {
              <div class="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm text-gray-700 max-w-[85%]">
                Bonjour 👋 Je peux répondre à vos questions sur la souscription, les émissions BTA/OTA, le compte joint, les documents... Que puis-je faire pour vous ?
              </div>
            }
            @for (m of messages(); track $index) {
              <div class="flex" [class.justify-end]="m.role === 'user'">
                <div class="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm break-words"
                     [class.bg-afb-red]="m.role === 'user'"
                     [class.text-white]="m.role === 'user'"
                     [class.rounded-tr-sm]="m.role === 'user'"
                     [class.whitespace-pre-wrap]="m.role === 'user'"
                     [class.bg-white]="m.role === 'assistant'"
                     [class.border]="m.role === 'assistant'"
                     [class.border-gray-200]="m.role === 'assistant'"
                     [class.text-gray-700]="m.role === 'assistant'"
                     [class.rounded-tl-sm]="m.role === 'assistant'">
                  @if (m.role === 'assistant') {
                    <afb-chat-message [content]="m.content" />
                  } @else {
                    {{ m.content }}
                  }
                </div>
              </div>
            }
            @if (sending()) {
              <div class="flex">
                <div class="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-3.5 py-2.5">
                  <span class="inline-flex gap-1">
                    <span class="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style="animation-delay:0ms"></span>
                    <span class="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style="animation-delay:150ms"></span>
                    <span class="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style="animation-delay:300ms"></span>
                  </span>
                </div>
              </div>
            }
          </div>
          <form class="flex items-center gap-2 p-2.5 border-t border-gray-100 shrink-0" (ngSubmit)="send()">
            <input class="flex-1 text-sm rounded-full border border-gray-200 px-3.5 py-2 focus:outline-none focus:ring-2 focus:ring-afb-red/30"
                   [(ngModel)]="draft" name="draft" placeholder="Posez votre question..." [disabled]="sending()" autocomplete="off" />
            <button type="submit" class="w-9 h-9 rounded-full bg-afb-red text-white grid place-items-center shrink-0 disabled:opacity-40"
                    [disabled]="sending() || !draft.trim()" aria-label="Envoyer">➤</button>
          </form>
        </div>
      }
      <button class="w-14 h-14 rounded-full bg-afb-red text-white shadow-xl grid place-items-center hover:brightness-110 transition overflow-hidden"
              (click)="toggle()" [attr.aria-label]="open() ? 'Fermer l\\'assistant' : 'Ouvrir l\\'assistant'">
        @if (open()) {
          <span class="text-2xl">✕</span>
        } @else {
          <img src="/AI_mascot.png" alt="Ouvrir l'assistant" class="w-11 h-11 object-contain" />
        }
      </button>
    </div>
  `,
})
export class ChatbotWidget {
  private readonly api = inject(ApiService);
  private readonly platformId = inject(PLATFORM_ID);

  @ViewChild('scrollArea') private scrollArea?: ElementRef<HTMLDivElement>;

  open = signal(false);
  sending = signal(false);
  draft = '';
  messages = signal<ChatMessageDto[]>([]);

  toggle() {
    this.open.update((o) => !o);
  }

  send() {
    const text = this.draft.trim();
    if (!text || this.sending()) return;
    const history = this.messages();
    this.messages.set([...history, { role: 'user', content: text }]);
    this.draft = '';
    this.sending.set(true);
    this.scrollSoon();
    this.api.sendChatMessage(text, history).subscribe({
      next: (reply) => {
        this.messages.update((m) => [...m, { role: 'assistant', content: reply }]);
        this.sending.set(false);
        this.scrollSoon();
      },
      error: () => {
        this.messages.update((m) => [
          ...m,
          { role: 'assistant', content: "Désolé, une erreur est survenue. Réessayez dans un instant." },
        ]);
        this.sending.set(false);
        this.scrollSoon();
      },
    });
  }

  private scrollSoon() {
    if (!isPlatformBrowser(this.platformId)) return;
    setTimeout(() => {
      const el = this.scrollArea?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}
