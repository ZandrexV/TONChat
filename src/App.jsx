import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";
import Auth from "./components/Auth";
import ProfileSetup from "./components/ProfileSetup";
import Chat from "./components/Chat";
import "./styles.css";

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [overlay, setOverlay] = useState(null); // null | "auth" | "profile"

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setProfile(null);
      if (session) setOverlay("profile-check");
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .single();
      setProfile(data);
      // if they just logged in and have no username yet, prompt profile setup
      if (overlay === "profile-check") {
        setOverlay(data?.username ? null : "profile");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  if (loading) return <div className="center-msg">Loading…</div>;

  return (
    <>
      <Chat
        session={session}
        profile={profile}
        onRequestLogin={() => setOverlay("auth")}
      />

      {overlay === "auth" && (
        <div className="modal-overlay" onClick={() => setOverlay(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setOverlay(null)}>✕</button>
            <Auth onSuccess={() => setOverlay("profile-check")} />
          </div>
        </div>
      )}

      {overlay === "profile" && session && (
        <div className="modal-overlay">
          <div className="modal-card">
            <ProfileSetup
              session={session}
              profile={profile}
              onDone={async () => {
                const { data } = await supabase
                  .from("profiles")
                  .select("*")
                  .eq("id", session.user.id)
                  .single();
                setProfile(data);
                setOverlay(null);
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}

