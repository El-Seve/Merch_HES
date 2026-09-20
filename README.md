# Evidencias Merch HES

App para registrar y consultar evidencias fotográficas de entrega de merchandising de los promotores HES, con almacenamiento en OneDrive y generación de presentaciones PPTX.

## 1. Qué se entrega en este primer boceto funcional

- Backend Node/Express + SQLite (`backend/`) que sirve también el frontend (una sola app, un solo proceso).
- Frontend mobile-first en HTML/CSS/JS plano (sin build step) — funciona igual de bien en celular y en computadora.
- Integración real con OneDrive personal vía Microsoft Graph (MSAL), con **modo demostración** para probar todo sin credenciales de Azure.
- Correlativo global `Merch_0001.ext` → `Merch_9999.ext`, a prueba de cargas simultáneas (ver comentario en `backend/src/db.js`, función `reservarCorrelativo`).
- Generación de presentaciones PPTX (por tienda y consolidada) replicando el layout de `docs/Plantilla_Liquidación_Merch.pptx` que enviaste (portada + grilla de 10 fotos por diapositiva).
- Catálogo de tiendas/promotores **provisional** (2 tiendas y 2 promotores de ejemplo) — lo reemplazas por el real desde el panel Admin en cuanto me pases la tabla.
- Usuarios de prueba: `admin` / `admin` y `promotor1` / `1234`.

## 2. Herramientas usadas — validación de costos

Todo lo que usa este proyecto es gratuito / open source:

| Herramienta | Costo | Notas |
|---|---|---|
| Node.js, Express | Gratis (open source) | |
| SQLite (`better-sqlite3`) | Gratis (open source) | Base de datos como archivo, sin servidor aparte |
| React — **no se usó** | — | Se optó por HTML/JS plano para no depender de build tools |
| `@azure/msal-node` | Gratis (MIT) | Librería oficial de Microsoft para el login OAuth |
| Microsoft Graph API | Gratis | No tiene costo de uso para OneDrive personal; el límite es el **almacenamiento** de tu cuenta (5 GB gratis con cualquier cuenta Microsoft, ampliable con Microsoft 365 si algún día lo necesitas) |
| `pptxgenjs` | Gratis (MIT) | Generación de PowerPoint |
| `multer`, `bcryptjs`, `jsonwebtoken`, `archiver` | Gratis (open source) | |
| Azure App Registration | Gratis | Registrar la app en Azure Portal no tiene costo, ni siquiera necesitas suscripción de pago |

**Lo único que no es 100% gratis siempre es el hosting 24/7 del servidor** (para que promotores puedan usarlo desde el celular en cualquier momento). Opciones:
- **Gratis con limitaciones**: Render.com (free tier — el servidor "duerme" tras 15 min sin uso y demora ~30s en despertar) o Fly.io (free allowance mensual).
- **Costo bajo (~$5-7/mes)**: Railway, Render paid tier, o un VPS pequeño — sin el "sleep", ideal si tu equipo lo usa todo el día.

Te recomiendo arrancar en el free tier de Render para probar con tu equipo, y pasar a un plan pago solo si el "despertar" de 30 segundos molesta en campo.

## 3. Cómo probarlo YA en modo demostración (sin Azure)

```bash
cd backend
npm install
cp .env.example .env        # deja MODO=demo tal cual está
npm start
```

Abre `http://localhost:3000` en el celular (misma red Wi-Fi, usando la IP de tu compu) o en la computadora. Entra con `admin`/`admin` o `promotor1`/`1234`. Las fotos se guardan en `backend/data/demo-fotos/` en vez de OneDrive — todo el flujo (registro, correlativo, consulta, generación de PPTX) funciona igual.

## 4. Cómo conectar tu OneDrive personal real

1. Ve a **https://portal.azure.com** → busca "Registros de aplicaciones" (App registrations) → **Nuevo registro**.
2. Nombre: el que quieras (ej. "Merch HES"). En **Tipos de cuenta admitidos** elige **"Cuentas personales de Microsoft únicamente"**.
3. En **URI de redirección**, tipo "Web", pon: `http://localhost:3000/auth/onedrive/callback` (cuando despliegues en un dominio real, agrega también esa URL, ej. `https://tu-app.onrender.com/auth/onedrive/callback`).
4. Copia el **Application (client) ID** → va en `AZURE_CLIENT_ID` de tu `.env`.
5. Ve a **Certificados y secretos** → **Nuevo secreto de cliente** → cópialo apenas se genera (no se vuelve a mostrar) → va en `AZURE_CLIENT_SECRET`.
6. En permisos de API (**API permissions**) agrega **Microsoft Graph → Delegated → Files.ReadWrite** y **User.Read** (offline_access ya viene incluido por defecto).
7. En tu `.env`: `MODO=produccion`, `AZURE_TENANT=consumers`.
8. Arranca el servidor, entra como `admin`, ve al panel **Admin** → botón **"Conectar OneDrive"**. Te llevará a iniciar sesión con tu cuenta personal de Microsoft y autorizar el acceso — solo se hace **una vez**; el servidor guarda el token de renovación y de ahí en adelante sube solo.

Todas las fotos quedarán organizadas en tu OneDrive dentro de la carpeta `Merch_HES/{tienda}/{año}/{mes}/Merch_XXXX.ext`.

## 5. Desplegar en Render (gratis para empezar)

1. Sube esta carpeta a un repositorio de GitHub (privado).
2. En Render.com → New → Web Service → conecta el repo, root directory `backend`.
3. Build command: `npm install` — Start command: `npm start`.
4. Agrega las variables de entorno del `.env` en el panel de Render (incluyendo el `AZURE_REDIRECT_URI` apuntando a tu dominio de Render).
5. Actualiza también el URI de redirección en el App Registration de Azure para que coincida con el dominio de Render.

## 6. Pendiente de tu lado

- Pasarme la tabla real de **tiendas y promotores** (reemplaza el catálogo provisional desde el panel Admin, o te preparo un script de carga masiva si me pasas la tabla en Excel).
- Confirmar si quieres desplegarlo ya en Render/Railway o prefieres que te arme el paso a paso para tu propio hosting.

## 7. Estructura del proyecto

```
merch-hes-app/
├── README.md
├── docs/
│   └── Plantilla_Liquidación_Merch.pptx   (tu plantilla original, de referencia)
└── backend/
    ├── package.json
    ├── .env.example
    ├── data/                (SQLite + fotos demo — se genera al usar la app)
    ├── src/
    │   ├── server.js        (arranque, login, rutas)
    │   ├── db.js             (esquema SQLite + correlativo global)
    │   ├── auth.js           (login usuario/contraseña + JWT)
    │   ├── graph.js          (OneDrive vía Microsoft Graph + modo demo)
    │   ├── routes/
    │   │   ├── tiendas.js
    │   │   ├── promotores.js
    │   │   ├── entregas.js
    │   │   └── presentaciones.js
    │   └── pptx/
    │       ├── pptxComun.js              (layout replicado de tu plantilla)
    │       └── generarPresentaciones.js  (por tienda / consolidada)
    └── public/               (frontend: index.html, css/, js/)
```
