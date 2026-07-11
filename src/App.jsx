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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setProfile(null);
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
    })();
  }, [session]);

  if (loading) return <div className="center-msg">Loading…</div>;
  if (!session) return <Auth />;
  if (!profile || !profile.username) {
    return (
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
        }}
      />
    );
  }

  return <Chat session={session} profile={profile} />;
}
