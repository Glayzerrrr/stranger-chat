'use client';

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type FormEvent,
} from 'react';
import { createClient } from '@/lib/supabase/client';
import { filterMessage } from '@/lib/wordFilter';
import type { Message, ChatState } from '@/lib/types';
import SuspendedView from './SuspendedView';

const REPORT_REASONS = [
  'Spam or bot',
  'Harassment or hate speech',
  'Inappropriate content',
  'Scam / soliciting',
  'Other',
] as const;

const MAX_MESSAGE_LENGTH = 1000;

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ChatWindow({
  userId: initialUserId,
}: {
  userId?: string;
}) {
  // ---- Current user & moderation state ----
  const [currentUserId, setCurrentUserId] = useState<string | null>(
    initialUserId || null,
  );
  const [bannedReason, setBannedReason] = useState<string | null>(null);

  // ---- Chat state ----
  const [chatState, setChatState] = useState<ChatState>('idle');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [strangerTyping, setStrangerTyping] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [searchSeconds, setSearchSeconds] = useState(0);

  // ---- Report modal & feedback toast ----
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportReason, setReportReason] = useState<string>(REPORT_REASONS[0]);
  const [reportDetails, setReportDetails] = useState('');
  const [submittingReport, setSubmittingReport] = useState(false);
  const [reportedRoomId, setReportedRoomId] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    tone: 'neutral' | 'error';
  } | null>(null);

  // ---- Refs ----
  const supabase = useRef(createClient()).current;
  const roomChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(
    null,
  );
  const queueChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(
    null,
  );
  const queuePollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const ghostCheckTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const activeRoomIdRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatLogRef = useRef<Message[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback(
    (message: string, tone: 'neutral' | 'error' = 'neutral') => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      setToast({ message, tone });
      toastTimeoutRef.current = setTimeout(() => setToast(null), 4000);
    },
    [],
  );

  // Ensure an authenticated Google session exists
  useEffect(() => {
    supabase.auth
      .getUser()
      .then(({ data: { user } }) => {
        if (user && !user.is_anonymous) {
          setCurrentUserId(user.id);
        } else {
          window.location.href = '/';
        }
      })
      .catch(() => {
        window.location.href = '/';
      });
  }, [supabase]);

  // Keep chat log ref in sync for reports
  useEffect(() => {
    chatLogRef.current = messages;
  }, [messages]);

  // Auto-scroll to newest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, strangerTyping, chatState]);

  // Elapsed timer while searching
  useEffect(() => {
    if (chatState !== 'searching') {
      setSearchSeconds(0);
      return;
    }
    const timer = setInterval(() => {
      setSearchSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [chatState]);

  // ---- Cleanup helper ----
  const cleanup = useCallback(() => {
    activeRoomIdRef.current = null;

    if (ghostCheckTimeoutRef.current) {
      clearTimeout(ghostCheckTimeoutRef.current);
      ghostCheckTimeoutRef.current = undefined;
    }
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = undefined;
    }
    if (queuePollIntervalRef.current) {
      clearInterval(queuePollIntervalRef.current);
      queuePollIntervalRef.current = null;
    }

    // Tell partner we left, then remove channel after a short delay
    if (roomChannelRef.current) {
      const channelToRemove = roomChannelRef.current;
      channelToRemove.send({
        type: 'broadcast',
        event: 'disconnect',
        payload: {},
      });
      roomChannelRef.current = null;
      setTimeout(() => supabase.removeChannel(channelToRemove), 450);
    }

    if (queueChannelRef.current) {
      supabase.removeChannel(queueChannelRef.current);
      queueChannelRef.current = null;
    }

    // PostgREST query builders require .then() to actually execute the request
    if (currentUserId) {
      supabase
        .from('queue')
        .delete()
        .eq('user_id', currentUserId)
        .then(() => {});
    }
  }, [supabase, currentUserId]);

  // Cleanup on page unload
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
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      cleanup();
    };
  }, [cleanup]);

  // ---- Join a matched room ----
  const joinRoom = useCallback(
    (newRoomId: string, newPartnerId: string) => {
      // Prevent duplicate joins if Realtime + Polling both trigger for the same match
      if (activeRoomIdRef.current === newRoomId) return;
      activeRoomIdRef.current = newRoomId;

      setRoomId(newRoomId);
      setPartnerId(newPartnerId);
      setChatState('connected');
      setMessages([]);
      setStrangerTyping(false);

      if (ghostCheckTimeoutRef.current) {
        clearTimeout(ghostCheckTimeoutRef.current);
      }

      let partnerActive = false;

      const markPartnerActive = () => {
        if (!partnerActive) {
          partnerActive = true;
          if (ghostCheckTimeoutRef.current) {
            clearTimeout(ghostCheckTimeoutRef.current);
            ghostCheckTimeoutRef.current = undefined;
          }
        }
      };

      // Ghost detector: if partner never connects to room within 8 seconds, disconnect cleanly
      ghostCheckTimeoutRef.current = setTimeout(() => {
        if (!partnerActive && activeRoomIdRef.current === newRoomId) {
          activeRoomIdRef.current = null;
          setChatState('disconnected');
          setStrangerTyping(false);
          if (roomChannelRef.current) {
            supabase.removeChannel(roomChannelRef.current);
            roomChannelRef.current = null;
          }
        }
      }, 8000);

      const channel = supabase
        .channel(`room:${newRoomId}`)
        .on('presence', { event: 'sync' }, () => {
          const state = channel.presenceState<{ user_id?: string }>();
          const presentUserIds = Object.values(state).flatMap((presences) =>
            presences.map((p) => p.user_id),
          );
          if (presentUserIds.includes(newPartnerId)) {
            markPartnerActive();
          }
        })
        .on('presence', { event: 'join' }, ({ newPresences }) => {
          if (newPresences?.some((p) => p.user_id === newPartnerId)) {
            markPartnerActive();
          }
        })
        .on('presence', { event: 'leave' }, ({ leftPresences }) => {
          if (leftPresences?.some((p) => p.user_id === newPartnerId)) {
            activeRoomIdRef.current = null;
            setChatState('disconnected');
            setStrangerTyping(false);
            if (ghostCheckTimeoutRef.current) {
              clearTimeout(ghostCheckTimeoutRef.current);
            }
            supabase.removeChannel(channel);
            roomChannelRef.current = null;
          }
        })
        .on('broadcast', { event: 'message' }, ({ payload }) => {
          if (payload.sender_id !== currentUserId) {
            markPartnerActive();
            clearTimeout(typingTimeoutRef.current);
            setStrangerTyping(false);

            const { filtered } = filterMessage(payload.text);
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                text: filtered,
                sender: 'stranger',
                timestamp: payload.timestamp || Date.now(),
              },
            ]);
          }
        })
        .on('broadcast', { event: 'typing' }, ({ payload }) => {
          if (payload.sender_id !== currentUserId) {
            markPartnerActive();
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
          activeRoomIdRef.current = null;
          setChatState('disconnected');
          setStrangerTyping(false);
          if (ghostCheckTimeoutRef.current) {
            clearTimeout(ghostCheckTimeoutRef.current);
          }
          supabase.removeChannel(channel);
          roomChannelRef.current = null;
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED' && currentUserId) {
            try {
              await channel.track({ user_id: currentUserId });
            } catch (err) {
              console.warn('Presence track error:', err);
            }
          }
        });

      roomChannelRef.current = channel;

      // Only auto-focus on pointer-fine (desktop) devices so mobile keyboards don't jank
      if (
        typeof window !== 'undefined' &&
        window.matchMedia('(pointer: fine)').matches
      ) {
        setTimeout(() => inputRef.current?.focus(), 80);
      }
    },
    [supabase, currentUserId],
  );

  // ---- Find a match ----
  const findMatch = useCallback(async () => {
    if (!currentUserId) return;
    cleanup();
    setMessages([]);
    setInputText('');
    setStrangerTyping(false);
    setRoomId(null);
    setPartnerId(null);
    setReportedRoomId(null);
    setReportModalOpen(false);
    setChatState('searching');

    const { data, error } = await supabase.rpc('find_match', {
      searching_user_id: currentUserId,
    });

    if (error) {
      console.error('Match error:', error);
      if (error.message?.toLowerCase().includes('banned')) {
        setBannedReason(
          'Your account has been suspended due to violations of community guidelines.',
        );
        return;
      }
      showToast('Could not connect to matchmaking. Please try again.', 'error');
      setChatState('idle');
      return;
    }

    const result = data?.[0];

    if (result?.matched_room_id) {
      const partnerChannel = supabase.channel(
        `queue:${result.matched_partner_id}`,
      );
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
      const channelName = `queue:${currentUserId}`;
      const channel = supabase
        .channel(channelName)
        .on('broadcast', { event: 'matched' }, ({ payload }) => {
          if (payload?.room_id) {
            if (queuePollIntervalRef.current) {
              clearInterval(queuePollIntervalRef.current);
              queuePollIntervalRef.current = null;
            }
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
          (payload: { new?: { room_id?: string; matched_with?: string } }) => {
            if (payload?.new?.room_id && payload?.new?.matched_with) {
              if (queuePollIntervalRef.current) {
                clearInterval(queuePollIntervalRef.current);
                queuePollIntervalRef.current = null;
              }
              joinRoom(payload.new.room_id, payload.new.matched_with);
              supabase.removeChannel(channel);
              queueChannelRef.current = null;
            }
          },
        )
        .subscribe();

      queueChannelRef.current = channel;

      // Fast polling fallback + queue heartbeat every ~4.5s
      let pollTicks = 0;
      queuePollIntervalRef.current = setInterval(async () => {
        pollTicks++;

        if (pollTicks % 3 === 0 && currentUserId) {
          supabase
            .rpc('queue_heartbeat', { searching_user_id: currentUserId })
            .then(() => {});
        }

        const { data: queueRow } = await supabase
          .from('queue')
          .select('room_id, matched_with')
          .eq('user_id', currentUserId)
          .single();

        if (queueRow?.room_id && queueRow?.matched_with) {
          if (queuePollIntervalRef.current) {
            clearInterval(queuePollIntervalRef.current);
            queuePollIntervalRef.current = null;
          }
          joinRoom(queueRow.room_id, queueRow.matched_with);
          if (queueChannelRef.current) {
            supabase.removeChannel(queueChannelRef.current);
            queueChannelRef.current = null;
          }
        }
      }, 1500);
    }
  }, [supabase, currentUserId, cleanup, joinRoom, showToast]);

  // ---- Send a message ----
  const sendMessage = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault();
      const text = inputText.trim().slice(0, MAX_MESSAGE_LENGTH);
      if (
        !text ||
        !roomChannelRef.current ||
        chatState !== 'connected' ||
        !currentUserId
      ) {
        return;
      }

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
      setInputText(value.slice(0, MAX_MESSAGE_LENGTH));

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

  // ---- Skip / Cancel / Sign out ----
  const skipChat = useCallback(() => {
    cleanup();
    findMatch();
  }, [cleanup, findMatch]);

  const cancelSearch = useCallback(() => {
    cleanup();
    setRoomId(null);
    setPartnerId(null);
    setChatState('idle');
  }, [cleanup]);

  const signOut = useCallback(async () => {
    cleanup();
    await supabase.auth.signOut();
    window.location.href = '/';
  }, [supabase, cleanup]);

  // ---- Report Modal handlers ----
  const openReportModal = useCallback(() => {
    if (!partnerId || !roomId || reportedRoomId === roomId) return;
    setReportReason(REPORT_REASONS[0]);
    setReportDetails('');
    setReportModalOpen(true);
  }, [partnerId, roomId, reportedRoomId]);

  const submitReportForm = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!partnerId || !roomId || submittingReport) return;

      setSubmittingReport(true);
      const trimmedDetails = reportDetails.trim();
      const combinedReason = trimmedDetails
        ? `${reportReason}: ${trimmedDetails}`
        : reportReason;

      const { error } = await supabase.rpc('submit_report', {
        p_reported_id: partnerId,
        p_room_id: roomId,
        p_chat_log: chatLogRef.current,
        p_reason: combinedReason,
      });

      setSubmittingReport(false);

      if (error) {
        if (error.message?.toLowerCase().includes('already reported')) {
          setReportedRoomId(roomId);
          setReportModalOpen(false);
          showToast('You already reported this conversation.');
          return;
        }
        console.error('Report error:', error);
        showToast('Could not submit report. Please try again.', 'error');
        return;
      }

      setReportedRoomId(roomId);
      setReportModalOpen(false);

      if (chatState === 'connected') {
        showToast('Report submitted. Finding a new match...');
        skipChat();
      } else {
        showToast('Report submitted. Thank you for keeping the chat safe.');
      }
    },
    [
      partnerId,
      roomId,
      submittingReport,
      reportReason,
      reportDetails,
      supabase,
      chatState,
      skipChat,
      showToast,
    ],
  );

  // ---- Global keyboard shortcuts (Esc to skip/cancel/close, Enter on disconnected) ----
  useEffect(() => {
    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (reportModalOpen) {
          e.preventDefault();
          setReportModalOpen(false);
        } else if (chatState === 'connected') {
          e.preventDefault();
          skipChat();
        } else if (chatState === 'searching') {
          e.preventDefault();
          cancelSearch();
        }
      } else if (
        e.key === 'Enter' &&
        chatState === 'disconnected' &&
        !reportModalOpen &&
        document.activeElement?.tagName !== 'BUTTON'
      ) {
        e.preventDefault();
        findMatch();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [reportModalOpen, chatState, skipChat, cancelSearch, findMatch]);

  // If account was banned at runtime, render the suspension view
  if (bannedReason) {
    return (
      <SuspendedView
        reason={bannedReason}
        userId={currentUserId ?? undefined}
      />
    );
  }

  const alreadyReported = Boolean(roomId && reportedRoomId === roomId);
  const canReport =
    Boolean(partnerId && roomId) &&
    (chatState === 'connected' || chatState === 'disconnected');

  // ================================================================
  //  RENDER
  // ================================================================
  return (
    <div className="flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden bg-canvas">
      {/* ---- Header ---- */}
      <header className="flex shrink-0 items-center justify-between border-b border-white/[0.08] bg-surface/90 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm bg-accent" />
            <h1 className="text-base font-bold tracking-tight text-[#f4f4f0] sm:text-lg">
              StrangerChat
            </h1>
          </div>

          {/* Live Status Pill */}
          <div className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-surface-light px-2.5 py-1 font-mono text-[11px] font-medium">
            {chatState === 'idle' && (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
                <span className="text-zinc-400">Standby</span>
              </>
            )}
            {chatState === 'searching' && (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
                </span>
                <span className="text-accent">
                  Matching {formatElapsed(searchSeconds)}
                </span>
              </>
            )}
            {chatState === 'connected' && (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span className="text-emerald-400">Live</span>
              </>
            )}
            {chatState === 'disconnected' && (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                <span className="text-red-400">Ended</span>
              </>
            )}
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          {canReport && (
            <button
              onClick={openReportModal}
              disabled={alreadyReported}
              title={
                alreadyReported
                  ? 'Already reported this chat'
                  : 'Report stranger'
              }
              className="cursor-pointer rounded-lg border border-white/[0.08] bg-surface-light px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:border-red-500/35 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {alreadyReported ? 'Reported' : 'Report'}
            </button>
          )}
          <button
            onClick={signOut}
            className="cursor-pointer rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-white/[0.05] hover:text-zinc-200"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* ---- Toast Banner ---- */}
      {toast && (
        <div className="pointer-events-none fixed left-1/2 top-16 z-40 w-full max-w-sm -translate-x-1/2 px-4">
          <div
            className={`rounded-xl border px-4 py-2.5 text-center text-xs font-medium shadow-xl backdrop-blur-md ${
              toast.tone === 'error'
                ? 'border-red-500/30 bg-red-950/90 text-red-200'
                : 'border-white/10 bg-surface-lighter/95 text-zinc-200'
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}

      {/* ---- Chat Area ---- */}
      <main
        className={`min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 ${
          chatState === 'idle' || chatState === 'searching' ? 'bg-dot-grid' : ''
        }`}
      >
        {/* Idle state */}
        {chatState === 'idle' && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-surface p-7 shadow-2xl">
              <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-accent/25 bg-accent-muted text-accent">
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="1.75"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z"
                  />
                </svg>
              </div>
              <h2 className="text-xl font-bold tracking-tight text-[#f4f4f0]">
                Ready when you are
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                Get paired 1-on-1 with someone online right now. Say hi, or skip
                anytime.
              </p>
              <button
                onClick={findMatch}
                className="mt-6 w-full cursor-pointer rounded-xl bg-accent px-6 py-3.5 text-sm font-bold text-[#0c0c0e] transition-all hover:bg-accent-hover active:scale-[0.98]"
              >
                Start Chatting
              </button>
            </div>
          </div>
        )}

        {/* Searching state */}
        {chatState === 'searching' && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="relative mb-7 h-16 w-16 search-pulse">
              <div className="absolute inset-0 flex items-center justify-center rounded-full border border-accent/30 bg-surface">
                <span className="h-3 w-3 rounded-full bg-accent" />
              </div>
            </div>
            <h2 className="text-lg font-bold tracking-tight text-[#f4f4f0]">
              Looking for someone online…
            </h2>
            <p className="mt-1.5 font-mono text-xs text-zinc-500">
              Elapsed {formatElapsed(searchSeconds)}
            </p>
            <button
              onClick={cancelSearch}
              className="mt-6 cursor-pointer rounded-xl border border-white/10 bg-surface px-5 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-surface-lighter hover:text-white"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Connected / Disconnected message thread */}
        {(chatState === 'connected' || chatState === 'disconnected') && (
          <div className="mx-auto max-w-2xl pb-2">
            {/* Session start divider */}
            <div className="mb-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-white/[0.07]" />
              <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                Connected to a stranger
              </span>
              <div className="h-px flex-1 bg-white/[0.07]" />
            </div>

            {/* Messages with clean turn grouping */}
            <div className="flex flex-col">
              {messages.map((msg, idx) => {
                const prev = messages[idx - 1];
                const next = messages[idx + 1];
                const isFirst = !prev || prev.sender !== msg.sender;
                const isLast = !next || next.sender !== msg.sender;
                const isMe = msg.sender === 'me';

                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} ${
                      isFirst ? 'mt-3.5 first:mt-0' : 'mt-1'
                    }`}
                  >
                    {isFirst && (
                      <span className="mb-1 px-1 text-[11px] font-medium text-zinc-500">
                        {isMe ? 'You' : 'Stranger'}
                      </span>
                    )}
                    <div
                      className={`max-w-[82%] sm:max-w-[72%] px-3.5 py-2.5 text-sm leading-relaxed [overflow-wrap:anywhere] ${
                        isMe
                          ? `bg-[#f4f4f0] text-[#0c0c0e] rounded-2xl ${
                              isLast ? 'rounded-br-sm' : ''
                            }`
                          : `border border-white/[0.08] bg-surface-light text-[#f4f4f0] rounded-2xl ${
                              isLast ? 'rounded-bl-sm' : ''
                            }`
                      }`}
                    >
                      {msg.text}
                    </div>
                    {isLast && (
                      <span className="mt-1 px-1 font-mono text-[10px] text-zinc-600">
                        {formatTime(msg.timestamp)}
                      </span>
                    )}
                  </div>
                );
              })}

              {/* Typing indicator */}
              {strangerTyping && chatState === 'connected' && (
                <div className="mt-3.5 flex flex-col items-start">
                  <span className="mb-1 px-1 text-[11px] font-medium text-zinc-500">
                    Stranger
                  </span>
                  <div className="rounded-2xl rounded-bl-sm border border-white/[0.08] bg-surface-light px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                    </div>
                  </div>
                </div>
              )}

              {/* Disconnected notice */}
              {chatState === 'disconnected' && (
                <div className="mt-6 flex items-center gap-3">
                  <div className="h-px flex-1 bg-red-500/20" />
                  <span className="font-mono text-[11px] uppercase tracking-wider text-red-400/90">
                    Stranger disconnected
                  </span>
                  <div className="h-px flex-1 bg-red-500/20" />
                </div>
              )}
            </div>

            <div ref={messagesEndRef} />
          </div>
        )}
      </main>

      {/* ---- Footer / Composer ---- */}
      <footer
        className={`shrink-0 border-t border-white/[0.08] bg-surface/95 px-3 py-3 backdrop-blur-md sm:px-6 ${
          chatState === 'idle' || chatState === 'searching'
            ? 'hidden sm:block'
            : ''
        }`}
      >
        {chatState === 'connected' && (
          <div className="mx-auto max-w-2xl">
            <form onSubmit={sendMessage} className="flex items-center gap-2">
              <button
                type="button"
                onClick={skipChat}
                title="Skip stranger (Esc)"
                className="shrink-0 cursor-pointer rounded-xl border border-white/10 bg-surface-light px-3 py-2.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-white/20 hover:bg-surface-lighter hover:text-white active:scale-[0.97] sm:px-3.5"
              >
                Skip
              </button>

              <div className="relative min-w-0 flex-1">
                <input
                  ref={inputRef}
                  type="text"
                  value={inputText}
                  onChange={(e) => handleInputChange(e.target.value)}
                  maxLength={MAX_MESSAGE_LENGTH}
                  placeholder="Message stranger..."
                  className="w-full rounded-xl border border-white/[0.08] bg-surface-light px-3.5 py-2.5 text-sm text-[#f4f4f0] placeholder-zinc-500 outline-none transition-colors focus:border-accent/60 focus:bg-surface-lighter"
                />
                {inputText.length > 750 && (
                  <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[10px] text-zinc-500">
                    {inputText.length}/{MAX_MESSAGE_LENGTH}
                  </span>
                )}
              </div>

              <button
                type="submit"
                disabled={!inputText.trim()}
                className="shrink-0 cursor-pointer rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-[#0c0c0e] transition-all hover:bg-accent-hover active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-accent"
              >
                Send
              </button>
            </form>
          </div>
        )}

        {chatState === 'disconnected' && (
          <div className="mx-auto flex max-w-2xl items-center justify-center gap-3">
            <button
              onClick={findMatch}
              className="cursor-pointer rounded-xl bg-accent px-6 py-2.5 text-sm font-bold text-[#0c0c0e] transition-all hover:bg-accent-hover active:scale-[0.97]"
            >
              New Chat
            </button>
            {partnerId && (
              <button
                onClick={openReportModal}
                disabled={alreadyReported}
                className="cursor-pointer rounded-xl border border-white/10 bg-surface-light px-4 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:border-red-500/35 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {alreadyReported ? 'Reported' : 'Report'}
              </button>
            )}
          </div>
        )}

        {(chatState === 'idle' || chatState === 'searching') && (
          <div className="text-center font-mono text-[11px] text-zinc-500">
            Press{' '}
            <kbd className="rounded border border-white/10 bg-surface-light px-1.5 py-0.5 text-zinc-400">
              Esc
            </kbd>{' '}
            to skip anytime
          </div>
        )}
      </footer>

      {/* ---- In-App Report Modal ---- */}
      {reportModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm"
          onClick={() => !submittingReport && setReportModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-surface p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-[#f4f4f0]">
                  Report Stranger
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                  The current chat log will be attached for moderation review.
                  {chatState === 'connected' &&
                    ' Submitting will end this chat immediately.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReportModalOpen(false)}
                disabled={submittingReport}
                className="cursor-pointer rounded-lg p-1 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
                aria-label="Close modal"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18 18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <form onSubmit={submitReportForm} className="mt-5 space-y-4">
              <div>
                <label className="mb-2 block text-xs font-medium text-zinc-400">
                  Select a reason
                </label>
                <div className="flex flex-wrap gap-2">
                  {REPORT_REASONS.map((reasonOption) => {
                    const selected = reportReason === reasonOption;
                    return (
                      <button
                        key={reasonOption}
                        type="button"
                        onClick={() => setReportReason(reasonOption)}
                        className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                          selected
                            ? 'border-red-500/50 bg-red-500/15 text-red-300'
                            : 'border-white/10 bg-surface-light text-zinc-300 hover:border-white/20'
                        }`}
                      >
                        {reasonOption}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                  Additional details (optional)
                </label>
                <input
                  type="text"
                  value={reportDetails}
                  onChange={(e) => setReportDetails(e.target.value)}
                  maxLength={200}
                  placeholder="Briefly describe what happened..."
                  className="w-full rounded-xl border border-white/10 bg-surface-light px-3.5 py-2.5 text-sm text-[#f4f4f0] placeholder-zinc-500 outline-none focus:border-red-500/50"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setReportModalOpen(false)}
                  disabled={submittingReport}
                  className="cursor-pointer rounded-xl border border-white/10 px-4 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-surface-lighter disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingReport}
                  className="cursor-pointer rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-50"
                >
                  {submittingReport
                    ? 'Submitting...'
                    : chatState === 'connected'
                      ? 'Submit & Skip'
                      : 'Submit Report'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
