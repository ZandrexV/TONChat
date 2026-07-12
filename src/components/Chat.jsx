import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "../supabaseClient";

function timeString(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function guestId() {
  let id = localStorage.getItem("nightline_guest_id");
  if (!id) {
    id = `guest-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem("nightline_guest_id", id);
  }
  return id;
}

// --- reply preview shown above a message or above the composer ---------

function ReplyPreview({ message, onClear }) {
  if (!message) return null;
  return (
    <div className="reply-preview">
      <div className="reply-preview-line" />
      <div className="reply-preview-text">
        <span className="reply-preview-name">{message.guest_name || message.authorName || "…"}</span>
        <span className="reply-preview-body">{message.text}</span>
      </div>
      {onClear && <button className="reply-preview-clear" onClick={onClear}>✕</button>}
    </div>
  );
}

// --- action menu shown under a message when you tap it ---------

function MessageActions({ msg, canEdit, canModerate, onReply, onEdit, onDelete, onPin, onBan, onClose }) {
  return (
    <div className="msg-actions">
      <button onClick={() => { onReply(); onClose(); }}>Reply</button>
      {canEdit && <button onClick={() => { onEdit(); onClose(); }}>Edit</button>}
      {(canEdit || canModerate) && (
        <button className="danger" onClick={() => { onDelete(); onClose(); }}>Delete</button>
      )}
      {canModerate && (
        <button onClick={() => { onPin(); onClose(); }}>{msg.is_pinned ? "Unpin" : "Pin"}</button>
      )}
      {canModerate && !canEdit && (
        <button className="danger" onClick={() => { onBan(); onClose(); }}>Ban</button>
      )}
    </div>
  );
}

// --- guest composer ---------

function GuestComposer({ onSend, replyTarget, onClearReply }) {
  const [name, setName] = useState(() => localStorage.getItem("nightline_guest_name") || "");
  const [text, setText] = useState("");
  const [error, setError] = useState(null);

  const send = async () => {
    const cleanName = name.trim();
    const cleanText = text.trim();
    if (!cleanName) { setError("Enter a name first."); return; }
    if (!cleanText) return;
    setError(null);
    localStorage.setItem("nightline_guest_name", cleanName);
    const ok = await onSend({ guest_name: cleanName, text: cleanText, reply_to: replyTarget?.id || null });
    if (ok) { setText(""); onClearReply(); }
    else setError("Couldn't send — you may be restricted from posting.");
  };

  return (
    <div className="composer-wrap">
      <ReplyPreview message={replyTarget} onClear={onClearReply} />
      <div className="composer guest-composer">
        <input
          className="guest-name-input"
          placeholder="Your name"
          value={name}
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
        />
        <textarea
          rows={1}
          placeholder="Message the room…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button disabled={!text.trim()} onClick={send}>Send</button>
        {error && <span className="composer-error">{error}</span>}
      </div>
    </div>
  );
}

// --- main chat ---------

export default function Chat({ session, profile, onRequestLogin }) {
  const [messages, setMessages] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [draft, setDraft] = useState("");
  const [openActionsFor, setOpenActionsFor] = useState(null);
  const [replyTarget, setReplyTarget] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const [onlineIds, setOnlineIds] = useState(new Set());
  const [onlineCount, setOnlineCount] = useState(0);
  const [banner, setBanner] = useState(null);
  const bottomRef = useRef(null);

  const loggedIn = !!(session && profile?.username);
  const canModerate = loggedIn && (profile.role === "mod" || profile.role === "admin");
  const myIdentity = loggedIn ? session.user.id : guestId();

  const messageById = useMemo(() => {
    const map = {};
    messages.forEach((m) => { map[m.id] = m; });
    return map;
  }, [messages]);

  const pinned = useMemo(() => messages.filter((m) => m.is_pinned), [messages]);

  const loadProfiles = useCallback(async (userIds) => {
    const ids = [...new Set(userIds)].filter(Boolean);
    if (ids.length === 0) return;
    const { data } = await supabase.from("profiles").select("*").in("id", ids);
    if (data) {
      setProfiles((p) => {
        const next = { ...p };
        data.forEach((row) => { next[row.id] = row; });
        return next;
      });
    }
  }, []);

  // initial load
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(200);
      if (data) {
        setMessages(data);
        loadProfiles(data.flatMap((m) => [m.user_id, m.pinned_by]));
      }
    })();
  }, [loadProfiles]);

  // realtime: insert / update / delete
  useEffect(() => {
    const channel = supabase
      .channel("messages-room")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        setMessages((prev) => [...prev, payload.new]);
        if (payload.new.user_id) loadProfiles([payload.new.user_id]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (payload) => {
        setMessages((prev) => prev.map((m) => (m.id === payload.new.id ? payload.new : m)));
        if (payload.new.pinned_by) loadProfiles([payload.new.pinned_by]);
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, (payload) => {
        setMessages((prev) => prev.filter((m) => m.id !== payload.old.id));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [loadProfiles]);

  // presence: who's online right now
  useEffect(() => {
    const channel = supabase.channel("presence-room", {
      config: { presence: { key: myIdentity } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        setOnlineIds(new Set(Object.keys(state)));
        setOnlineCount(Object.keys(state).length);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            name: loggedIn ? profile.username : (localStorage.getItem("nightline_guest_name") || "guest"),
            online_at: new Date().toISOString(),
          });
        }
      });

    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myIdentity, loggedIn]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const sendAsUser = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    const target = replyTarget;
    setReplyTarget(null);
    const { error } = await supabase.from("messages").insert({
      user_id: session.user.id,
      text,
      reply_to: target?.id || null,
    });
    if (error) setBanner("Couldn't send — you may be restricted from posting.");
  };

  const sendAsGuest = async ({ guest_name, text, reply_to }) => {
    const { error } = await supabase.from("messages").insert({ guest_name, text, reply_to });
    return !error;
  };

  const saveEdit = async (id) => {
    const text = editText.trim();
    if (!text) return;
    await supabase.from("messages").update({ text, edited_at: new Date().toISOString() }).eq("id", id);
    setEditingId(null);
  };

  const deleteMine = async (id) => { await supabase.from("messages").delete().eq("id", id); };
  const modDelete = async (id) => {
    const { error } = await supabase.rpc("mod_delete_message", { msg_id: id });
    if (error) setBanner("Couldn't delete that message.");
  };
  const togglePin = async (msg) => {
    const { error } = await supabase.rpc("toggle_pin", { msg_id: msg.id, pin: !msg.is_pinned });
    if (error) setBanner("Couldn't pin/unpin that message.");
  };
  const banAuthor = async (msg) => {
    if (msg.guest_name) {
      const { error } = await supabase.rpc("ban_guest", { guest_name_input: msg.guest_name });
      if (error) setBanner("Couldn't ban that guest.");
      else setBanner(`Banned guest name "${msg.guest_name}".`);
    } else {
      const { error } = await supabase.rpc("ban_user", { target_id: msg.user_id });
      if (error) setBanner("Couldn't ban that user.");
      else setBanner("User banned.");
    }
  };

  const logout = () => supabase.auth.signOut();

  const renderRow = (m, { inPinnedBar } = {}) => {
    const isGuestMsg = !!m.guest_name;
    const author = !isGuestMsg ? profiles[m.user_id] : null;
    const displayName = isGuestMsg ? m.guest_name : (author?.username || "…");
    const role = author?.role;
    const mine = !isGuestMsg && loggedIn && m.user_id === session.user.id;
    const isOnline = !isGuestMsg && m.user_id && onlineIds.has(m.user_id);
    const replyMsg = m.reply_to ? messageById[m.reply_to] : null;
    const replyAuthor = replyMsg && !replyMsg.guest_name ? profiles[replyMsg.user_id] : null;

    return (
      <div key={m.id} className={`row ${inPinnedBar ? "in-pinned" : ""}`}>
        <div className="avatar-wrap">
          {!isGuestMsg && author?.avatar_url
            ? <img className="msg-avatar" src={author.avatar_url} alt="" />
            : <div className="msg-avatar placeholder">{displayName?.[0]?.toUpperCase() || "?"}</div>}
          {isOnline && <span className="online-dot" title="Online" />}
        </div>

        <div className="msg-content">
          <div className="msg-meta">
            <span className={`name-tag ${role === "admin" ? "name-admin" : ""}`}>{displayName}</span>
            {isGuestMsg && <span className="role-pill role-guest">guest</span>}
            {!isGuestMsg && role && role !== "member" && (
              <span className={`role-pill role-${role}`}>{role}</span>
            )}
            {m.is_pinned && !inPinnedBar && <span className="pin-flag">📌</span>}
            <span className="stamp">{timeString(m.created_at)}</span>
          </div>

          {replyMsg && (
            <ReplyPreview
              message={{ ...replyMsg, authorName: replyAuthor?.username }}
            />
          )}
          {m.reply_to && !replyMsg && (
            <div className="reply-preview reply-unavailable">
              <div className="reply-preview-line" />
              <span className="reply-preview-body">original message unavailable</span>
            </div>
          )}

          {editingId === m.id ? (
            <div className="edit-box">
              <textarea
                rows={1}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(m.id); } }}
                autoFocus
              />
              <button onClick={() => saveEdit(m.id)}>Save</button>
              <button className="ghost" onClick={() => setEditingId(null)}>Cancel</button>
            </div>
          ) : (
            <div
              className="bubble"
              onClick={() => !inPinnedBar && setOpenActionsFor(openActionsFor === m.id ? null : m.id)}
            >
              {m.text}
              {m.edited_at && <span className="edited-flag"> (edited)</span>}
            </div>
          )}

          {!inPinnedBar && openActionsFor === m.id && editingId !== m.id && (
            <MessageActions
              msg={m}
              canEdit={mine}
              canModerate={canModerate}
              onReply={() => setReplyTarget(m)}
              onEdit={() => { setEditingId(m.id); setEditText(m.text); }}
              onDelete={() => (mine ? deleteMine(m.id) : modDelete(m.id))}
              onPin={() => togglePin(m)}
              onBan={() => banAuthor(m)}
              onClose={() => setOpenActionsFor(null)}
            />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="room">
      <div className="header">
        {loggedIn ? (
          <div className="who">
            {profile.avatar_url
              ? <img className="mini-avatar" src={profile.avatar_url} alt="" />
              : <div className="mini-avatar placeholder">{profile.username[0].toUpperCase()}</div>}
            <div>
              <h2>Nightline</h2>
              <span className="sub">signed in as {profile.username}{canModerate && ` · ${profile.role}`}</span>
            </div>
          </div>
        ) : (
          <div className="who">
            <h2>Nightline</h2>
            <span className="sub">browsing as guest</span>
          </div>
        )}
        <div className="header-right">
          <span className="online-count"><span className="online-count-dot" />{onlineCount} online</span>
          {loggedIn
            ? <button className="logout" onClick={logout}>Log out</button>
            : <button className="logout" onClick={onRequestLogin}>Log in</button>}
        </div>
      </div>

      {pinned.length > 0 && (
        <div className="pinned-bar">
          {pinned.map((m) => {
            const pinner = m.pinned_by ? profiles[m.pinned_by] : null;
            return (
              <div key={m.id} className="pinned-item">
                <div className="pinned-by">
                  <span className="pinned-icon">📌</span>
                  {pinner && (
                    <>
                      Pinned by <span className={`pinned-by-name ${pinner.role === "admin" ? "name-admin" : ""}`}>{pinner.username}</span>
                      {pinner.role !== "member" && <span className={`role-pill role-${pinner.role}`}>{pinner.role}</span>}
                    </>
                  )}
                </div>
                <div className="pinned-body">
                  <span className="pinned-name">{m.guest_name || profiles[m.user_id]?.username || "…"}:</span>
                  <span className="pinned-text">{m.text}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {banner && (
        <div className="banner">
          {banner}
          <button onClick={() => setBanner(null)}>✕</button>
        </div>
      )}

      <div className="scroll">
        {messages.length === 0 && <div className="empty">No messages yet — say something.</div>}
        {messages.map((m) => renderRow(m))}
        <div ref={bottomRef} />
      </div>

      {loggedIn ? (
        <div className="composer-wrap">
          <ReplyPreview message={replyTarget} onClear={() => setReplyTarget(null)} />
          <div className="composer">
            <textarea
              rows={1}
              placeholder="Message the room…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAsUser(); } }}
            />
            <button disabled={!draft.trim()} onClick={sendAsUser}>Send</button>
          </div>
        </div>
      ) : (
        <GuestComposer onSend={sendAsGuest} replyTarget={replyTarget} onClearReply={() => setReplyTarget(null)} />
      )}
    </div>
  );
}
