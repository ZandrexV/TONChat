import { useState } from "react";
import { supabase } from "../supabaseClient";

export default function ProfileSetup({ session, profile, onDone }) {
  const [username, setUsername] = useState(profile?.username || "");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(profile?.avatar_url || null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const save = async () => {
    if (!username.trim()) return;
    setSaving(true);
    setError(null);

    let avatar_url = profile?.avatar_url || null;

    try {
      if (file) {
        const ext = file.name.split(".").pop();
        const path = `${session.user.id}/avatar.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(path, file, { upsert: true });
        if (uploadError) throw uploadError;

        const { data } = supabase.storage.from("avatars").getPublicUrl(path);
        avatar_url = data.publicUrl;
      }

      const { error: upsertError } = await supabase
        .from("profiles")
        .upsert({ id: session.user.id, username: username.trim(), avatar_url });
      if (upsertError) throw upsertError;

      onDone();
    } catch (e) {
      setError(e.message || "Something went wrong saving your profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="auth-screen">
      <h1>Set up your profile</h1>
      <p className="sub">This is what other people in the room will see.</p>

      <label className="avatar-picker">
        {preview ? (
          <img src={preview} alt="Avatar preview" />
        ) : (
          <div className="avatar-placeholder">+</div>
        )}
        <input type="file" accept="image/*" onChange={handleFile} hidden />
      </label>

      <input
        placeholder="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        maxLength={20}
      />

      <button onClick={save} disabled={saving || !username.trim()}>
        {saving ? "Saving…" : "Save and continue"}
      </button>

      {error && <p className="error">{error}</p>}
    </div>
  );
}
