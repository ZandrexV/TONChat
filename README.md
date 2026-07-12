# Nightline — chat en tiempo real con Supabase + Cloudflare Pages

Una app de chat con login real, fotos de perfil y mensajes en vivo, construida con:
- **Supabase**: Auth, Postgres, Storage (avatares), Realtime
- **Cloudflare Pages**: hosting del frontend ya compilado
- **Vite + React**: frontend

## 1. Configurar Supabase

1. Creá un proyecto en [supabase.com](https://supabase.com).
2. Andá a **SQL Editor** → pegá el contenido de `supabase/schema.sql` → ejecutalo.
   - Esto crea las tablas `profiles` y `messages`, las políticas RLS,
     un bucket de storage `avatars`, y activa Realtime en `messages`.
   - Si las líneas del bucket o del `alter publication` tiran error porque
     ya existen, no pasa nada — el resto se aplica igual.
3. Andá a **Authentication > Providers** y asegurate de que **Email** esté activado.
   (Opcional: agregá login con Google/GitHub ahí mismo.)
4. Andá a **Settings > API** y copiá tu **Project URL** y tu **anon public key**.

## 2. Correrlo local

```bash
npm install
cp .env.example .env
# pegá tu URL y anon key de Supabase en .env
npm run dev
```

Abrí la URL local que te muestra Vite (normalmente `http://localhost:5173`).

## 3. Desplegar en Cloudflare Pages

1. Subí este proyecto a un repo de GitHub.
2. En el dashboard de Cloudflare: **Workers & Pages > Create > Pages > Connect to Git**.
3. Seleccioná tu repo. Configuración de build:
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
4. En **Settings > Environment variables**, agregá:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Desplegá. Cloudflare te va a dar una URL `*.pages.dev` (después podés agregar un dominio propio).

## Cómo funciona

- **Registro / login** — lo maneja Supabase Auth (`src/components/Auth.jsx`).
- **Configuración inicial de perfil** — elegís un username y subís un avatar,
  que va al bucket `avatars` de Storage (`src/components/ProfileSetup.jsx`).
- **Sala de chat** — carga los mensajes recientes y se suscribe a Supabase
  Realtime, así los mensajes nuevos de cualquiera aparecen al instante
  (`src/components/Chat.jsx`).

## Limpieza automática (90 días)

Los mensajes con más de 90 días se borran solos, para que la tabla no crezca
sin límite. Esto corre del lado de Supabase con `pg_cron`, así que funciona
aunque nadie entre a la app ese día.

Antes de correr el `schema.sql`, activá la extensión (si no lo hiciste ya):
**Database > Extensions** en el dashboard de Supabase → buscá `pg_cron` → activala.

Si en algún momento querés cambiar los 90 días o desactivar la limpieza:

```sql
-- cambiar a, por ejemplo, 30 días
select cron.schedule(
  'delete-old-messages',
  '0 3 * * *',
  $$ delete from messages where created_at < now() - interval '30 days'; $$
);

-- o desactivarla directamente
select cron.unschedule('delete-old-messages');
```

## Chat anónimo (invitados)

No hace falta registrarse para usar el chat:

- **Cualquiera puede leer** los mensajes sin loguearse.
- **Cualquiera puede escribir** poniendo solo un nombre (sin cuenta). Esos
  mensajes se guardan con `guest_name` en vez de `user_id`, y muestran una
  pill gris de "guest" junto al nombre.
- El botón **Log in** del header es opcional, para quienes quieran tener
  usuario fijo, foto de perfil y rol (mod/admin).
- Un invitado no puede borrar sus mensajes después de enviarlos (no hay forma
  de comprobar que son suyos sin cuenta) — solo los usuarios logueados pueden
  borrar los propios.
- El nombre de invitado se guarda en el navegador (`localStorage`) para no
  tener que escribirlo cada vez, pero no impide que otra persona use el mismo
  nombre. Si te importa evitar suplantación, es mejor incentivar el login.

## Funciones nuevas

**Responder (reply)** — cualquiera (incluso invitados) puede tocar un mensaje
y elegir "Reply"; el mensaje nuevo queda enlazado al original y se muestra
una vista previa arriba. Si el original se borra, la vista previa dice
"original message unavailable" en vez de romperse.

**Editar / borrar tu propio mensaje** — solo usuarios logueados (los
invitados no tienen forma de probar que el mensaje es suyo). Se marca con
"(edited)" cuando corresponde. Está reforzado con permisos a nivel de
columna en la base (`grant update (text, edited_at)`), así que aunque alguien
intente mandar una request manual, solo puede tocar esos dos campos de sus
propios mensajes.

**Pin de mensajes** — solo mods/admins. Los mensajes fijados aparecen en una
barra debajo del header con formato tipo Twitch: "📌 Pinned by NombreDelMod
[MOD]" arriba, y el mensaje fijado debajo. Se hace a través de una función
de Postgres (`toggle_pin`) que guarda quién lo fijó (`pinned_by`) y verifica
el rol del que la llama, no confía en el cliente.

**Filtro de palabras** — corre en la base (trigger `filter_bad_words`), no en
el frontend, así que no se puede evitar llamando a la API directo. La lista
de palabras está vacía por defecto (`ejemplo1`, `ejemplo2` como placeholder)
— editá el array `bad_words` en `schema.sql` con tu propia lista y volvé a
correr esa función.

**Menú al tocar un mensaje** — tocar cualquier mensaje abre un menú con
"Reply" para todos, y "Edit/Delete" (autor), "Pin/Unpin" y "Ban" (mods/admins)
según corresponda.

**Banear usuarios/invitados** — los mods pueden banear desde ese mismo menú.
A un usuario registrado se le marca `banned = true` en su perfil (no puede
volver a postear hasta que un mod lo desbanee con `unban_user`). A un
invitado se le banea el *nombre* (no hay otra forma de identificarlo), así
que alguien podría volver a escribir con otro nombre — es una limitación
inherente al chat anónimo.

**Contador de usuarios en línea y estado online** — usa Presence de Supabase
Realtime. El header muestra cuántas personas están conectadas ahora mismo, y
los mensajes de usuarios registrados que siguen conectados muestran un
puntito verde sobre su avatar. Los invitados no tienen indicador de online
individual (no tienen una identidad estable entre pestañas), pero sí cuentan
para el contador total.

**GIF como foto de perfil** — ya funciona sin cambios: el selector de avatar
acepta cualquier imagen (`image/*`), incluidos GIFs, y como se muestran con
una etiqueta `<img>` normal, se animan solos.

## Sobre los roles (pills)

Cada perfil tiene una columna `role` (`member`, `mod` o `admin`). Por defecto
todos son `member` y no muestran pill en el chat; `mod` y `admin` sí muestran
una etiqueta de color junto al nombre, como en Chatango.

No hay una pantalla en la app para cambiar el rol de alguien (para evitar que
un usuario se lo asigne a sí mismo). Para hacer admin o mod a alguien, andá a
**Table Editor > profiles** en el dashboard de Supabase y editá el valor de
`role` a mano, o corré:

```sql
update profiles set role = 'admin' where username = 'nombre_de_usuario';
```

## Notas sobre seguridad

- Row Level Security (RLS) está activo en todas las tablas, así que un
  usuario solo puede editar su propio perfil y sus propios mensajes,
  aunque todos puedan leer el chat compartido.
- La `anon key` es segura para exponer en el código del frontend; lo que
  realmente protege tus datos es RLS, no mantener la key en secreto.
