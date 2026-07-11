import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../supabaseClient";

function timeString(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function Chat({ session, profile }) {
  const [messages, setMessages] = useState([]);
  const [profiles, setProfiles] = useState({}); // user_id -> profile
  const [draft, setDraft] = useState("");
  const bottomRef = useRef(null);

  const loadProfiles = useCallback(async (userIds) => {
    const missing = userIds.filter((id) => !profiles[id]);
    if (missing.length === 0) return;
    const { data } = await supabase.from("profiles").select("*").in("id", missing);
    if (data) {
      setProfiles((prev) => {
        const next = { ...prev };
        data.forEach((p) => { next[p.id] = p; });
        return next;
      });
    }
  }, [profiles]);

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
        await loadProfiles([...new Set(data.map((m) => m.user_id))]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel("messages-room")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        async (payload) => {
          setMessages((prev) => [...prev, payload.new]);
          await loadProfiles([payload.new.user_id]);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await supabase.from("messages").insert({ user_id: session.user.id, text });
  };

  const logout = () => supabase.auth.signOut();

  return (
    <div className="room">
      <div className="header">
        <div className="who">
          {profile?.avatar_url ? (
            <img className="mini-avatar" src={profile.avatar_url} alt="" />
          ) : (
            <div className="mini-avatar placeholder">{profile?.username?.[0]?.toUpperCase()}</div>
          )}
          <div>
            <h2>Nightline</h2>
            <span className="sub">signed in as {profile?.username}</span>
          </div>
        </div>
        <button className="logout" onClick={logout}>Log out</button>
      </div>

      <div className="scroll">
        {messages.length === 0 && <div className="empty">No messages yet — say something.</div>}
        {messages.map((m) => {
          const author = profiles[m.user_id];
          const mine = m.user_id === session.user.id;
          return (
            <div key={m.id} className={`row ${mine ? "mine" : ""}`}>
              {!mine && (
                author?.avatar_url
                  ? <img className="msg-avatar" src={author.avatar_url} alt="" />
                  : <div className="msg-avatar placeholder">{author?.username?.[0]?.toUpperCase() || "?"}</div>
              )}
              <div className="bubble-wrap">
                {!mine && <span className="name-tag">{author?.username || "…"}</span>}
                <div className="bubble">{m.text}</div>
                <span className="stamp">{timeString(m.created_at)}</span>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="composer">
        <textarea
          rows={1}
          placeholder="Message the room…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
        />
        <button disabled={!draft.trim()} onClick={send}>Send</button>
      </div>
    </div>
  );
}
