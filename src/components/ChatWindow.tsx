'use client';

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { createClient } from '@/lib/supabase/client';
import { filterMessage } from '@/lib/wordFilter';
import type { Message, ChatState } from '@/lib/types';

// ----------------------------------------------------------------
// ChatWindow — the core of the entire app.
//
// Responsibilities:
//   1. Matchmaking via Supabase RPC + Realtime subscription
//   2. Chat via Supabase Broadcast channels
//   3. Skip / disconnect / report
// ----------------------------------------------------------------

export default function ChatWindow({
  userId: initialUserId,
  userEmail: initialUserEmail,
}: {
  userId?: string;
  userEmail?: string;
}) {
  // ---- Current user state ----
  const [currentUserId, setCurrentUserId] = useState<string | null>(initialUserId || null);

  // ---- State ----
  const [chatState, setChatState] = useState<ChatState>('idle');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [strangerTyping, setStrangerTyping] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [partnerId, setPartnerId] = useState<string | null>(null);

  // ---- Refs (persist across renders without causing re-renders) ----
  const supabase = useRef(createClient()).current;
  const roomChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const queueChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatLogRef = useRef<Message[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ensure an authenticated or anonymous session exists
  useEffect(() => {
    if (!currentUserId) {
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) {
          setCurrentUserId(user.id);
        } else {
          supabase.auth.signInAnonymously().then(({ data: { user: anonUser } }) => {
            if (anonUser) setCurrentUserId(anonUser.id);
          });
        }
      }).catch(() => {
        supabase.auth.signInAnonymously().then(({ data: { user: anonUser } }) => {
          if (anonUser) setCurrentUserId(anonUser.id);
        });
      });
    }
  }, [currentUserId, supabase]);

  // ---- Keep chat log ref in sync (for report submission) ----
  useEffect(() => {
    chatLogRef.current = messages;
  }, [messages]);

  // ---- Auto-scroll to newest message ----
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, strangerTyping]);

  // ---- Cleanup helper ----
  const cleanup = useCallback(() => {
    if (queuePollIntervalRef.current) {
      clearInterval(queuePollIntervalRef.current);
      queuePollIntervalRef.current = null;
    }
    // Tell the partner we left
    if (roomChannelRef.current) {
      roomChannelRef.current.send({
        type: 'broadcast',
        event: 'disconnect',
        payload: {},
      });
      supabase.removeChannel(roomChannelRef.current);
      roomChannelRef.current = null;
    }
    // Stop listening for queue matches
    if (queueChannelRef.current) {
      supabase.removeChannel(queueChannelRef.current);
      queueChannelRef.current = null;
    }
    // Remove ourselves from the queue (best-effort)
    if (currentUserId) {
      supabase.from('queue').delete().eq('user_id', currentUserId);
    }
  }, [supabase, currentUserId]);

  // ---- Cleanup on page unload ----
  useEffect(() => {
    const handleUnload = () => {
      if (roomChannelRef.current) {
        roomChannelRef.current.send({
          type: 'broadcast',
          event: 'disconnect',
          payload: {},
        });
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      cleanup();
    };
  }, [cleanup]);

  // ---- Join a matched room ----
  const joinRoom = useCallback(
    (newRoomId: string, newPartnerId: string) => {
      setRoomId(newRoomId);
      setPartnerId(newPartnerId);
      setChatState('connected');
      setMessages([]);
      setStrangerTyping(false);

      const channel = supabase
        .channel(`room:${newRoomId}`)
        .on('broadcast', { event: 'message' }, ({ payload }) => {
          if (payload.sender_id !== currentUserId) {
            // Stranger sent a message: immediately clear stranger's typing indicator
            clearTimeout(typingTimeoutRef.current);
            setStrangerTyping(false);

            const { filtered } = filterMessage(payload.text);
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                text: filtered,
                sender: 'stranger',
                timestamp: payload.timestamp,
              },
            ]);
          }
        })
        .on('broadcast', { event: 'typing' }, ({ payload }) => {
          if (payload.sender_id !== currentUserId) {
            setStrangerTyping(true);
            clearTimeout(typingTimeoutRef.current);
            typingTimeoutRef.current = setTimeout(
              () => setStrangerTyping(false),
              2000,
            );
          }
        })
        .on('broadcast', { event: 'stop_typing' }, ({ payload }) => {
          if (payload.sender_id !== currentUserId) {
            clearTimeout(typingTimeoutRef.current);
            setStrangerTyping(false);
          }
        })
        .on('broadcast', { event: 'disconnect' }, () => {
          setChatState('disconnected');
          setStrangerTyping(false);
          supabase.removeChannel(channel);
          roomChannelRef.current = null;
        })
        .subscribe();

      roomChannelRef.current = channel;

      // Focus the input
      setTimeout(() => inputRef.current?.focus(), 100);
    },
    [supabase, currentUserId],
  );

  // ---- Find a match ----
  const queuePollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const findMatch = useCallback(async () => {
    if (!currentUserId) return;
    cleanup();
    if (queuePollIntervalRef.current) {
      clearInterval(queuePollIntervalRef.current);
      queuePollIntervalRef.current = null;
    }

    setMessages([]);
    setInputText('');
    setStrangerTyping(false);
    setRoomId(null);
    setPartnerId(null);
    setChatState('searching');

    const { data, error } = await supabase.rpc('find_match', {
      searching_user_id: currentUserId,
    });

    if (error) {
      console.error('Match error:', error);
      setChatState('idle');
      return;
    }

    const result = data?.[0];

    if (result?.matched_room_id) {
      // Instant match! Notify partner via broadcast as well
      const partnerChannel = supabase.channel(`queue:${result.matched_partner_id}`);
      partnerChannel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          partnerChannel.send({
            type: 'broadcast',
            event: 'matched',
            payload: {
              room_id: result.matched_room_id,
              partner_id: currentUserId,
            },
          });
          setTimeout(() => supabase.removeChannel(partnerChannel), 2000);
        }
      });

      joinRoom(result.matched_room_id, result.matched_partner_id);
    } else {
      // No one waiting — subscribe to queue updates via Realtime and Broadcast
      const channelName = `queue:${currentUserId}`;
      const channel = supabase
        .channel(channelName)
        .on('broadcast', { event: 'matched' }, ({ payload }) => {
          if (payload?.room_id) {
            if (queuePollIntervalRef.current) clearInterval(queuePollIntervalRef.current);
            joinRoom(payload.room_id, payload.partner_id);
            supabase.removeChannel(channel);
            queueChannelRef.current = null;
          }
        })
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'queue',
            filter: `user_id=eq.${currentUserId}`,
          },
          (payload: any) => {
            if (payload?.new?.room_id) {
              if (queuePollIntervalRef.current) clearInterval(queuePollIntervalRef.current);
              joinRoom(payload.new.room_id, payload.new.matched_with);
              supabase.removeChannel(channel);
              queueChannelRef.current = null;
            }
          },
        )
        .subscribe();

      queueChannelRef.current = channel;

      // Fast polling fallback: checks DB every 1.5s in case realtime event was missed
      queuePollIntervalRef.current = setInterval(async () => {
        const { data: queueRow } = await supabase
          .from('queue')
          .select('room_id, matched_with')
          .eq('user_id', currentUserId)
          .single();

        if (queueRow?.room_id) {
          if (queuePollIntervalRef.current) clearInterval(queuePollIntervalRef.current);
          joinRoom(queueRow.room_id, queueRow.matched_with);
          if (queueChannelRef.current) {
            supabase.removeChannel(queueChannelRef.current);
            queueChannelRef.current = null;
          }
        }
      }, 1500);
    }
  }, [supabase, currentUserId, cleanup, joinRoom]);

  // ---- Send a message ----
  const sendMessage = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault();
      const text = inputText.trim();
      if (!text || !roomChannelRef.current || chatState !== 'connected' || !currentUserId) return;

      const { filtered } = filterMessage(text);

      const message: Message = {
        id: crypto.randomUUID(),
        text: filtered,
        sender: 'me',
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, message]);
      setInputText('');

      roomChannelRef.current.send({
        type: 'broadcast',
        event: 'message',
        payload: {
          text: filtered,
          sender_id: currentUserId,
          timestamp: message.timestamp,
        },
      });

      // Broadcast stop_typing so stranger's screen immediately removes typing dots
      roomChannelRef.current.send({
        type: 'broadcast',
        event: 'stop_typing',
        payload: { sender_id: currentUserId },
      });
    },
    [inputText, chatState, currentUserId],
  );

  // ---- Typing indicator ----
  const lastTypingBroadcast = useRef(0);
  const handleInputChange = useCallback(
    (value: string) => {
      setInputText(value);

      // Throttle typing broadcasts to once per second
      const now = Date.now();
      if (
        roomChannelRef.current &&
        chatState === 'connected' &&
        currentUserId &&
        now - lastTypingBroadcast.current > 1000
      ) {
        lastTypingBroadcast.current = now;
        roomChannelRef.current.send({
          type: 'broadcast',
          event: 'typing',
          payload: { sender_id: currentUserId },
        });
      }
    },
    [chatState, currentUserId],
  );

  // ---- Report ----
  const handleReport = useCallback(async () => {
    if (!partnerId || !roomId) return;

    const confirmed = window.confirm(
      'Report this user for inappropriate behavior?\n\nThe chat log will be saved for review.',
    );
    if (!confirmed) return;

    const reason = window.prompt('Reason (optional):') || 'No reason provided';

    const { error } = await supabase.rpc('submit_report', {
      p_reported_id: partnerId,
      p_room_id: roomId,
      p_chat_log: chatLogRef.current,
      p_reason: reason,
    });

    if (error) {
      console.error('Report error:', error);
      alert('Failed to submit report. Please try again.');
    } else {
      alert('Report submitted. Thank you for helping keep the community safe.');
    }
  }, [supabase, partnerId, roomId]);

  // ---- Skip (disconnect + immediately search again) ----
  const skipChat = useCallback(() => {
    cleanup();
    findMatch();
  }, [cleanup, findMatch]);

  // ---- Cancel search ----
  const cancelSearch = useCallback(() => {
    cleanup();
    setChatState('idle');
  }, [cleanup]);

  // ---- Sign out ----
  const signOut = useCallback(async () => {
    cleanup();
    await supabase.auth.signOut();
    window.location.href = '/';
  }, [supabase, cleanup]);

  // ---- Enter to send, Escape to skip ----
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape' && chatState === 'connected') {
        skipChat();
      }
    },
    [chatState, skipChat],
  );

  // ================================================================
  //  RENDER
  // ================================================================

  return (
    <div className="flex flex-col h-screen max-h-screen">
      {/* ---- Header ---- */}
      <header className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-white/10 bg-surface/80 backdrop-blur-md shrink-0">
        <h1 className="text-lg font-bold tracking-tight">
          Stranger<span className="text-blue-500">Chat</span>
        </h1>

        {/* Status pill */}
        <div className="flex items-center gap-2 text-sm">
          {chatState === 'idle' && (
            <span className="text-gray-500">Ready</span>
          )}
          {chatState === 'searching' && (
            <span className="flex items-center gap-2 text-yellow-400">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-yellow-400" />
              </span>
              Searching…
            </span>
          )}
          {chatState === 'connected' && (
            <span className="flex items-center gap-2 text-green-400">
              <span className="h-2.5 w-2.5 rounded-full bg-green-400" />
              Connected
            </span>
          )}
          {chatState === 'disconnected' && (
            <span className="text-red-400">Disconnected</span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={signOut}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors cursor-pointer"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* ---- Chat area ---- */}
      <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        {/* Idle state */}
        {chatState === 'idle' && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-6xl mb-6">💬</div>
            <h2 className="text-2xl font-bold mb-2">Ready to chat?</h2>
            <p className="text-gray-500 mb-8 max-w-sm">
              You&apos;ll be connected with a random stranger for an anonymous
              conversation.
            </p>
            <button
              onClick={findMatch}
              className="bg-blue-600 hover:bg-blue-500 text-white font-semibold
                         px-8 py-3.5 rounded-xl transition-colors active:scale-[0.97] cursor-pointer"
            >
              Start Chatting
            </button>
          </div>
        )}

        {/* Searching state */}
        {chatState === 'searching' && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="relative w-16 h-16 mb-6 search-pulse">
              <div className="absolute inset-0 flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-blue-500 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              </div>
            </div>
            <h2 className="text-xl font-semibold mb-2">
              Looking for someone…
            </h2>
            <p className="text-gray-500 mb-6">
              You&apos;ll be connected as soon as another user joins.
            </p>
            <button
              onClick={cancelSearch}
              className="text-sm text-gray-500 hover:text-white transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Connected / Disconnected — show messages */}
        {(chatState === 'connected' || chatState === 'disconnected') && (
          <div className="max-w-2xl mx-auto space-y-1">
            {/* System message */}
            <div className="text-center text-sm text-green-500/80 py-2 mb-2">
              You&apos;re now chatting with a random stranger. Say hi!
            </div>

            {/* Messages */}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.sender === 'me' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[75%] px-4 py-2 rounded-2xl text-sm break-words ${
                    msg.sender === 'me'
                      ? 'bg-blue-600 text-white rounded-br-md'
                      : 'bg-surface-lighter text-gray-200 rounded-bl-md'
                  }`}
                >
                  <span className="text-[10px] font-semibold opacity-60 block mb-0.5">
                    {msg.sender === 'me' ? 'You' : 'Stranger'}
                  </span>
                  {msg.text}
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {strangerTyping && chatState === 'connected' && (
              <div className="flex justify-start">
                <div className="bg-surface-lighter px-4 py-2.5 rounded-2xl rounded-bl-md">
                  <span className="text-[10px] font-semibold text-gray-500 block mb-1">
                    Stranger
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                  </div>
                </div>
              </div>
            )}

            {/* Disconnected notice */}
            {chatState === 'disconnected' && (
              <div className="text-center text-sm text-red-400/80 py-4">
                Stranger has disconnected.
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </main>

      {/* ---- Bottom bar ---- */}
      <footer className="shrink-0 border-t border-white/10 bg-surface/80 backdrop-blur-md px-4 sm:px-6 py-3">
        {chatState === 'connected' && (
          <div className="max-w-2xl mx-auto flex items-center gap-2">
            <form onSubmit={sendMessage} className="flex-1 flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={inputText}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message…"
                autoFocus
                className="flex-1 bg-surface-lighter text-white placeholder-gray-500
                           rounded-xl px-4 py-2.5 text-sm outline-none
                           focus:ring-2 focus:ring-blue-500/50 transition-shadow"
              />
              <button
                type="submit"
                disabled={!inputText.trim()}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-30 disabled:hover:bg-blue-600
                           text-white px-4 py-2.5 rounded-xl text-sm font-medium
                           transition-all cursor-pointer disabled:cursor-not-allowed"
              >
                Send
              </button>
            </form>

            <button
              onClick={skipChat}
              title="Skip (Esc)"
              className="text-sm text-gray-500 hover:text-yellow-400 transition-colors px-3 py-2.5 cursor-pointer"
            >
              Skip ⏭
            </button>
            <button
              onClick={handleReport}
              title="Report this user"
              className="text-sm text-gray-500 hover:text-red-400 transition-colors px-2 py-2.5 cursor-pointer"
            >
              🚩
            </button>
          </div>
        )}

        {chatState === 'disconnected' && (
          <div className="max-w-2xl mx-auto flex items-center justify-center gap-4">
            <button
              onClick={findMatch}
              className="bg-blue-600 hover:bg-blue-500 text-white font-semibold
                         px-6 py-2.5 rounded-xl transition-colors active:scale-[0.97] cursor-pointer"
            >
              New Chat
            </button>
            {partnerId && (
              <button
                onClick={handleReport}
                className="text-sm text-gray-500 hover:text-red-400 transition-colors cursor-pointer"
              >
                🚩 Report
              </button>
            )}
          </div>
        )}

        {(chatState === 'idle' || chatState === 'searching') && (
          <div className="text-center text-xs text-gray-600">
            Press <kbd className="px-1.5 py-0.5 bg-surface-lighter rounded text-gray-400">Esc</kbd> to
            skip &middot; Messages are never stored unless reported
          </div>
        )}
      </footer>
    </div>
  );
}
