import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth-service';

/** Message d'un fil de discussion, tel qu'échangé sur le WebSocket et l'historique REST. */
export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderRole: string;
  contenu: string;
  createdAt: string;
}

/** Fil de discussion du client connecté (`GET /chat/conversation`). */
export interface MyConversation {
  id: string;
  clientId: string;
  agentId: string | null;
  statut: 'OUVERTE' | 'FERMEE';
  unread: number;
}

/** Un fil, vu du back-office (`GET /chat/conversations`). */
export interface ConversationSummary {
  id: string;
  clientId: string;
  clientNom: string;
  clientPrenom: string | null;
  agentId: string | null;
  agentNom: string | null;
  statut: 'OUVERTE' | 'FERMEE';
  dernierMessage: string | null;
  updatedAt: string;
  unread: number;
}

/**
 * Messagerie en direct client <-> back-office : historique + liste via REST,
 * échange des messages via WebSocket (canal unique par fil de discussion).
 */
@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly api = environment.apiBaseUrl;

  private socket: WebSocket | null = null;
  private currentConversationId: string | null = null;

  /** Messages du fil actuellement connecté (ordre chronologique). */
  readonly messages = signal<ChatMessage[]>([]);
  /** État de la connexion WebSocket courante. */
  readonly connected = signal(false);

  // ─────────────────────────────── REST ────────────────────────────────────

  myConversation(): Observable<MyConversation> {
    return this.http.get<MyConversation>(`${this.api}/chat/conversation`);
  }

  listConversations(): Observable<ConversationSummary[]> {
    return this.http.get<ConversationSummary[]>(`${this.api}/chat/conversations`);
  }

  history(conversationId: string): Observable<ChatMessage[]> {
    return this.http.get<ChatMessage[]>(`${this.api}/chat/conversations/${conversationId}/messages`);
  }

  markRead(conversationId: string): Observable<void> {
    return this.http.post<void>(`${this.api}/chat/conversations/${conversationId}/read`, {});
  }

  // ─────────────────────────────── WebSocket ────────────────────────────────

  /** Ouvre le canal temps réel d'un fil et charge son historique. Idempotent :
   *  ne rouvre pas la connexion si déjà connecté au même fil. */
  connect(conversationId: string): void {
    if (!this.isBrowser || this.currentConversationId === conversationId) {
      return;
    }
    this.disconnect();
    this.currentConversationId = conversationId;

    this.history(conversationId).subscribe((history) => this.messages.set(history));

    const token = this.auth.getAccessToken();
    if (!token) {
      return;
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws/chat/${conversationId}?token=${encodeURIComponent(token)}`;
    const socket = new WebSocket(url);
    socket.onopen = () => this.connected.set(true);
    socket.onclose = () => this.connected.set(false);
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as ChatMessage;
        this.messages.update((list) => [...list, message]);
      } catch {
        // Message non JSON — ignoré.
      }
    };
    this.socket = socket;
  }

  send(contenu: string): void {
    const text = contenu.trim();
    if (!text || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify({ contenu: text }));
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
    this.currentConversationId = null;
    this.connected.set(false);
    this.messages.set([]);
  }
}
