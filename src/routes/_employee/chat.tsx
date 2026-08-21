import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_employee/chat")({
  component: ChatPage,
});

import { useState, useEffect, useRef } from "react";
import { useNavigate } from "@/lib/router-compat";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Send, MessageCircle, ShieldCheck, BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTeamLeader } from "@/hooks/use-team-leader";
import { extractChatActions } from "@/hooks/use-next-step";
import { ChatActionButtons } from "@/components/ChatActionButtons";
import { EmojiPicker } from "@/components/EmojiPicker";
import { ChatAttachmentButton, AttachmentPreview, type ChatAttachment } from "@/components/ChatAttachmentButton";

interface ChatMessage {
  id: string;
  sender_id: string;
  receiver_id: string;
  message: string;
  read: boolean;
  created_at: string;
  attachment_url?: string | null;
  attachment_name?: string | null;
  attachment_type?: string | null;
  is_system?: boolean | null;
}

const PAGE_SIZE = 200;

// Rückfall für Altdaten ohne gesetztes is_system-Feld. "Hallo"/"Willkommen"
// sind raus – echte Teamleiter-Antworten beginnen oft so.
const SYSTEM_PREFIXES = ["✅", "🎓", "📋", "💰", "⚠️", "🎉", "📅", "✍️"];

function isSystemMessage(msg: ChatMessage, leaderId: string) {
  // Echte Server-Markierung hat Vorrang; nur wenn sie fehlt, wird geraten.
  if (typeof msg.is_system === "boolean") return msg.is_system;
  return msg.sender_id === leaderId && SYSTEM_PREFIXES.some((p) => msg.message.startsWith(p));
}

// Interne KI-/Eskalations-Nachrichten sind reine Admin-Infos und werden im Mitarbeiter-Chat ausgeblendet.
function isInternalAdminNote(msg: ChatMessage) {
  return (
    msg.message.startsWith("🤖 KI-Eskalation") ||
    msg.message.startsWith("🤖 KI Eskalation") ||
    msg.message.startsWith("[ESCALATE]")
  );
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function formatDateSeparator(dateStr: string) {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Heute";
  if (d.toDateString() === yesterday.toDateString()) return "Gestern";
  return d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
}

function ChatPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [teamLeaderId, setTeamLeaderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { leader, initials: leaderInitials, lastActiveText } = useTeamLeader();
  const [sending, setSending] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const typingSentAtRef = useRef(0);

  useEffect(() => {
    if (authLoading || !user) return;
    loadData();
  }, [user, authLoading]);

  const loadData = async () => {
    try {
      const { data: profile } = await supabase
        .from("profiles").select("team_leader_id").eq("user_id", user!.id).maybeSingle();
      const leaderId = profile?.team_leader_id ?? null;

      // NEUESTE Nachrichten laden (absteigend abfragen, danach chronologisch
      // sortieren). Vorher wurden die 200 ältesten geladen – neue Nachrichten
      // fehlten dadurch nach jedem Neuladen.
      const { data: msgs, error } = await supabase
        .from("chat_messages")
        .select("*")
        .or(`sender_id.eq.${user!.id},receiver_id.eq.${user!.id}`)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (error) throw error;

      setHasMore((msgs ?? []).length === PAGE_SIZE);
      const visible = ((msgs ?? []) as ChatMessage[])
        .filter((m) => !isInternalAdminNote(m))
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      setMessages(visible);

      // Empfänger: hinterlegter Teamleiter, sonst letzter Absender an mich.
      const lastIncoming = [...visible].reverse().find((m) => m.receiver_id === user!.id);
      setTeamLeaderId(leaderId ?? lastIncoming?.sender_id ?? null);

      await supabase
        .from("chat_messages")
        .update({ read: true } as any)
        .eq("receiver_id", user!.id)
        .eq("read", false);
    } catch (err: any) {
      console.error("Chat load error:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadOlder = async () => {
    if (!user || messages.length === 0) return;
    setLoadingOlder(true);
    const { data, error } = await supabase
      .from("chat_messages")
      .select("*")
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
      .lt("created_at", messages[0]!.created_at)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);
    setLoadingOlder(false);
    if (error) {
      console.error("Ältere Nachrichten konnten nicht geladen werden:", error);
      return;
    }
    setHasMore((data ?? []).length === PAGE_SIZE);
    const older = ((data ?? []) as ChatMessage[]).filter((m) => !isInternalAdminNote(m));
    setMessages((prev) => {
      const map = new Map<string, ChatMessage>();
      for (const m of [...older, ...prev]) map.set(m.id, m);
      return Array.from(map.values()).sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
    });
  };

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("chat-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (payload) => {
        const msg = payload.new as ChatMessage;
        if (msg.sender_id === user.id || msg.receiver_id === user.id) {
          // Interne Admin-/KI-Eskalations-Nachrichten im Mitarbeiter-Chat ausblenden
          if (isInternalAdminNote(msg)) return;
          if (msg.receiver_id === user.id && !teamLeaderId) setTeamLeaderId(msg.sender_id);
          setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]);
          // Chat ist offen → eingehende Nachricht sofort als gelesen markieren,
          // sonst bleibt der Ungelesen-Zähler in der Admin-Ansicht stehen.
          if (msg.receiver_id === user.id && !msg.read) {
            void supabase.from("chat_messages").update({ read: true } as any).eq("id", msg.id);
          }
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, teamLeaderId]);

  // Tipp-Indikator pro Gesprächspaar (gleicher Kanalname wie in der Admin-Ansicht).
  useEffect(() => {
    if (!user || !teamLeaderId) {
      setIsTyping(false);
      return;
    }
    const channelName = `typing-${[user.id, teamLeaderId].sort().join("-")}`;
    const channel = supabase.channel(channelName, { config: { broadcast: { self: false } } });
    channel
      .on("broadcast", { event: "typing" }, (payload) => {
        if (payload.payload?.userId !== teamLeaderId) return;
        if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
        if (payload.payload?.typing === false) {
          setIsTyping(false);
          return;
        }
        setIsTyping(true);
        typingTimeoutRef.current = window.setTimeout(() => setIsTyping(false), 3000);
      })
      .subscribe();
    typingChannelRef.current = channel;
    return () => {
      if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
      supabase.removeChannel(channel);
      typingChannelRef.current = null;
      setIsTyping(false);
    };
  }, [user, teamLeaderId]);

  // Leert der Nutzer das Feld oder sendet ab, geht sofort ein
  // "tippt nicht mehr" raus – kein Flackern, kein Hängenbleiben.
  const broadcastTyping = (text: string) => {
    if (!user || !typingChannelRef.current) return;
    const typing = text.trim().length > 0;
    if (!typing) {
      typingSentAtRef.current = 0;
      void typingChannelRef.current.send({
        type: "broadcast", event: "typing", payload: { userId: user.id, typing: false },
      });
      return;
    }
    const now = Date.now();
    if (now - typingSentAtRef.current < 1200) return;
    typingSentAtRef.current = now;
    void typingChannelRef.current.send({
      type: "broadcast",
      event: "typing",
      payload: { userId: user.id, typing: true },
    });
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const [pendingAttachment, setPendingAttachment] = useState<ChatAttachment | null>(null);

  const sendMessage = async () => {
    if ((!newMessage.trim() && !pendingAttachment) || !teamLeaderId || !user) return;
    setSending(true);
    const { error } = await supabase.from("chat_messages").insert({
      sender_id: user.id,
      receiver_id: teamLeaderId,
      message: newMessage.trim() || (pendingAttachment ? `📎 ${pendingAttachment.name}` : ""),
      attachment_url: pendingAttachment?.url ?? null,
      attachment_name: pendingAttachment?.name ?? null,
      attachment_type: pendingAttachment?.type ?? null,
    } as any);
    if (error) toast({ title: "Fehler", description: error.message, variant: "destructive" });
    setNewMessage("");
    broadcastTyping("");
    setPendingAttachment(null);
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  if (authLoading || loading) {
    return (
      <div className="flex flex-col h-[calc(100vh-3.5rem)]">
        <div className="border-b border-border bg-card px-5 py-3 flex items-center gap-3 shrink-0">
          <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
          <div className="space-y-1.5">
            <div className="h-4 w-24 bg-muted rounded animate-pulse" />
            <div className="h-3 w-16 bg-muted rounded animate-pulse" />
          </div>
        </div>
        <div className="flex-1" />
      </div>
    );
  }

  if (!teamLeaderId) {
    return (
      <div className="p-6 lg:p-8 max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-xl font-heading font-bold">Chat</h1>
        </div>
        <Card>
          <CardContent className="pt-6 text-center space-y-3">
            <MessageCircle className="h-10 w-10 text-muted-foreground/30 mx-auto" />
            <p className="text-sm font-medium text-foreground">Dein Ansprechpartner wird dir in Kürze zugewiesen.</p>
            <p className="text-xs text-muted-foreground">Du wirst benachrichtigt, sobald dein Teamleiter bereit ist.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Header */}
      <div className="border-b border-border bg-card px-5 py-3 flex items-center gap-3 shrink-0">
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => navigate("/dashboard")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="relative">
          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center overflow-hidden">
            {leader.avatar_url ? (
              <img src={leader.avatar_url} alt={leader.name} className="h-full w-full object-cover" />
            ) : (
              <span className="text-xs font-bold text-primary">{leaderInitials}</span>
            )}
          </div>
          {leader.is_online && (
            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-accent border-2 border-card" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold text-foreground">{leader.name}</p>
            <BadgeCheck className="h-3.5 w-3.5 text-primary" />
          </div>
          <p className="text-[10px] text-muted-foreground">{lastActiveText}{!leader.is_online && ` · ${leader.response_time}`}</p>
        </div>
        <Badge variant="secondary" className="text-[10px] bg-accent/10 text-accent gap-1">
          <ShieldCheck className="h-3 w-3" />
          Verifiziert
        </Badge>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-1">
        {hasMore && messages.length > 0 && (
          <div className="flex justify-center pb-2">
            <Button size="sm" variant="ghost" className="h-7 text-[11px]" disabled={loadingOlder} onClick={() => void loadOlder()}>
              {loadingOlder ? "Lädt…" : "Ältere Nachrichten laden"}
            </Button>
          </div>
        )}
        {messages.length === 0 && !isTyping && (
          <div className="text-center py-12 px-6">
            <div className="h-20 w-20 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary/10 ring-4 ring-primary/5 overflow-hidden">
              {leader.avatar_url ? (
                <img src={leader.avatar_url} alt={leader.name} className="h-full w-full object-cover" />
              ) : (
                <span className="text-2xl font-bold text-primary">{leaderInitials}</span>
              )}
            </div>
            <p className="text-lg font-heading font-bold text-foreground">{leader.name}</p>
            <p className="text-xs text-muted-foreground mt-1">{leader.title || "Dein persönlicher Ansprechpartner"}</p>
            {leader.is_online && (
              <Badge variant="secondary" className="mt-2 text-[10px] bg-accent/10 text-accent gap-1 px-2">
                <span className="h-1.5 w-1.5 rounded-full bg-accent inline-block animate-pulse" />
                Online
              </Badge>
            )}
            <div className="mt-6 mx-auto max-w-[260px] bg-muted/50 border border-border rounded-2xl px-4 py-3">
              <p className="text-sm text-foreground/80">👋 Hallo! Ich bin für dich da – bei Fragen, Problemen oder wenn du Hilfe brauchst. Schreib mir einfach!</p>
            </div>
            <p className="text-[10px] text-muted-foreground/60 mt-4">
              {leader.is_online ? "Antwort in wenigen Minuten" : leader.response_time}
            </p>
          </div>
        )}

        {messages.map((msg, idx) => {
          const isMine = msg.sender_id === user!.id;
          const isSys = isSystemMessage(msg, teamLeaderId);
          const prevMsg = idx > 0 ? messages[idx - 1] : null;
          const showDateSep = !prevMsg || new Date(prevMsg.created_at).toDateString() !== new Date(msg.created_at).toDateString();
          const sameSenderAsPrev = prevMsg && prevMsg.sender_id === msg.sender_id &&
            !showDateSep &&
            (new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime()) < 120000;

          // Extract action buttons for system/leader messages
          const chatActions = !isMine ? extractChatActions(msg.message) : [];

          return (
            <div key={msg.id}>
              {showDateSep && (
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    {formatDateSeparator(msg.created_at)}
                  </span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              )}

              {isSys ? (
                <div className="flex justify-center my-3">
                  <div className="bg-gradient-to-r from-muted/80 to-muted/50 border border-border rounded-2xl px-5 py-3 max-w-[85%]">
                    <p className="text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed">{msg.message}</p>
                    {chatActions.length > 0 && (
                      <ChatActionButtons actions={chatActions} />
                    )}
                    <p className="text-[9px] text-muted-foreground/60 mt-2 text-center">
                      {formatTime(msg.created_at)}
                    </p>
                  </div>
                </div>
              ) : (
                <div className={cn("flex items-end gap-2", isMine ? "justify-end" : "justify-start", sameSenderAsPrev ? "mt-0.5" : "mt-3")}>
                  {!isMine && (
                    <div className={cn("h-7 w-7 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center shrink-0 mb-1 overflow-hidden", sameSenderAsPrev && "invisible")}>
                      {leader.avatar_url ? (
                        <img src={leader.avatar_url} alt={leader.name} className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-[10px] font-bold text-primary">{leaderInitials}</span>
                      )}
                    </div>
                  )}
                  <div
                    className={cn(
                      "max-w-[70%] px-4 py-2.5 text-sm transition-all",
                      isMine
                        ? "bg-primary text-primary-foreground rounded-2xl rounded-br-md shadow-sm shadow-primary/20"
                        : "bg-card border border-border text-foreground rounded-2xl rounded-bl-md shadow-sm"
                    )}
                  >
                    {msg.message && <p className="whitespace-pre-wrap leading-relaxed">{msg.message}</p>}
                    {msg.attachment_url && msg.attachment_type && (
                      <AttachmentPreview
                        url={msg.attachment_url}
                        name={msg.attachment_name ?? "Anhang"}
                        type={msg.attachment_type}
                      />
                    )}
                    {!isMine && chatActions.length > 0 && (
                      <ChatActionButtons actions={chatActions} />
                    )}
                    <p className={cn("text-[10px] mt-1", isMine ? "text-primary-foreground/50" : "text-muted-foreground/60")}>
                      {formatTime(msg.created_at)}
                      {isMine && msg.read && " · Gelesen"}
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Typing indicator */}
        {isTyping && (
          <div className="flex items-end gap-2 mt-3 animate-fade-in">
            <div className="h-7 w-7 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center shrink-0 mb-1">
              <span className="text-[10px] font-bold text-primary">{leaderInitials}</span>
            </div>
            <div className="bg-card border border-border rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-primary font-semibold mr-1">Tippt gerade live...</span>
                <div className="h-2 w-2 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
                <div className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:150ms]" />
                <div className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border bg-card px-5 py-3 shrink-0 space-y-2">
        {pendingAttachment && (
          <div className="flex items-center gap-2 text-xs bg-muted/50 px-3 py-2 rounded-lg">
            <span className="flex-1 truncate">📎 {pendingAttachment.name}</span>
            <button
              type="button"
              onClick={() => setPendingAttachment(null)}
              className="text-muted-foreground hover:text-foreground"
            >
              Entfernen
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <ChatAttachmentButton userId={user!.id} onUploaded={setPendingAttachment} />
          <EmojiPicker onSelect={(e) => setNewMessage((m) => m + e)} />
          <Textarea
            value={newMessage}
            onChange={(e) => { setNewMessage(e.target.value); broadcastTyping(e.target.value); }}
            onKeyDown={handleKeyDown}
            placeholder="Nachricht schreiben… (Shift + Enter = neue Zeile)"
            rows={3}
            className="flex-1 rounded-xl border-border/60 focus-visible:ring-primary/30 min-h-[80px] max-h-60 resize-y py-2 text-sm"
          />
          <Button
            size="icon"
            onClick={sendMessage}
            disabled={(!newMessage.trim() && !pendingAttachment) || sending}
            className="h-10 w-10 rounded-xl transition-all hover:scale-105 active:scale-95 shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
