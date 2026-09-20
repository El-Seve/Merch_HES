# Evidencias Merch HES

App para registrar y consultar evidencias fotográficas de entrega de merchandising de los promotores HES, con almacenamiento en OneDrive y generación de presentaciones PPTX.

## 1. Qué se entrega en este primer boceto funcional

- Backend Node/Express + SQLite (`backend/`) que sirve también el frontend (una sola app, un solo proceso).
- Frontend mobile-first en HTML/CSS/JS plano (sin build step) — funciona igual de bien en celular y en computadora.
- Integración real con OneDrive personal vía **rclone** (sin Azure App Registration), con **modo demostración** para probar todo sin conectar nada aún.
- Correlativo global `Merch_0001.jpg` → `Merch_9999.jpg`, a prueba de cargas simultáneas (ver comentario en `backend/src/db.js`, función `reservarCorrelativo`).
- Cada foto se **comprime y redimensiona automáticamente** (máx. 1920px de lado, JPEG calidad 85 — visualmente igual, mucho más liviana) y lleva **marca de agua** con tienda, promotor y fecha/hora, antes de subirse (`backend/src/imagenes.js`).
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
| `rclone` | Gratis (open source, MIT) | Sube/lee archivos de OneDrive sin que tengas que registrar tu propia app en Azure |
| OneDrive / Microsoft Graph (usado por rclone) | Gratis | No tiene costo de uso para OneDrive personal; el límite es el **almacenamiento** de tu cuenta (5 GB gratis con cualquier cuenta Microsoft, ampliable con Microsoft 365 si algún día lo necesitas) |
| `pptxgenjs` | Gratis (MIT) | Generación de PowerPoint |
| `multer`, `bcryptjs`, `jsonwebtoken`, `archiver` | Gratis (open source) | |

**Lo único que no es 100% gratis siempre es el hosting 24/7 del servidor** (para que promotores puedan usarlo desde el celular en cualquier momento). Opciones:
- **Gratis con limitaciones**: Render.com (free tier — el servidor "duerme" tras 15 min sin uso y demora ~30s en despertar) o Fly.io (free allowance mensual).
- **Costo bajo (~$5-7/mes)**: Railway, Render paid tier, o un VPS pequeño — sin el "sleep", ideal si tu equipo lo usa todo el día.

Te recomiendo arrancar en el free tier de Render para probar con tu equipo, y pasar a un plan pago solo si el "despertar" de 30 segundos molesta en campo.

## 3. Cómo probarlo YA en modo demostración

```bash
cd backend
npm install
cp .env.example .env        # deja MODO=demo tal cual está
npm start
```

Abre `http://localhost:3000` en el celular (misma red Wi-Fi, usando la IP de tu compu) o en la computadora. Entra con `admin`/`admin` o `promotor1`/`1234`. Las fotos se guardan en `backend/data/demo-fotos/` en vez de OneDrive — todo el flujo (registro, correlativo, consulta, generación de PPTX) funciona igual.

## 4. Cómo conectar tu OneDrive personal real (vía rclone, sin Azure App Registration)

La app sube y lee archivos de OneDrive usando **rclone** (herramienta gratis y open source: rclone.org). rclone ya tiene su propia app registrada con Microsoft — no necesitas crear nada en Azure Portal ni lidiar con tenants. Solo autorizas tu cuenta **una vez, desde tu propia PC**, y luego pegas un archivo de configuración como variable de entorno en Render.

1. Instala rclone en tu PC: ve a **rclone.org/downloads** y baja el instalador de Windows (o Mac/Linux). Ábrelo, siguiente-siguiente.
2. Abre una terminal (PowerShell o CMD) y corre:
   ```
   rclone config
   ```
3. Te va a preguntar varias cosas, respóndelas así:
   - `n` (New remote)
   - `name>` escribe: `onedrive`
   - `Storage>` escribe el número que corresponda a **Microsoft OneDrive** (rclone te muestra la lista numerada)
   - `client_id>` y `client_secret>` → **déjalos vacíos**, solo presiona Enter (rclone usa los suyos propios)
   - Cuando pregunte por el tipo de cuenta, elige **OneDrive Personal or Business**
   - `Edit advanced config?` → `n`
   - `Use auto config?` → `y` (esto abre tu navegador)
   - En el navegador: inicia sesión con tu cuenta personal de Microsoft (la de tu OneDrive) y acepta los permisos. Vuelve a la terminal.
   - Cuando rclone liste tu(s) drive(s), confirma el que corresponde a tu OneDrive personal.
   - `y` para confirmar, `q` para salir del asistente.
4. Encuentra dónde quedó el archivo generado corriendo:
   ```
   rclone config file
   ```
   Te va a mostrar una ruta tipo `C:\Users\TuUsuario\.config\rclone\rclone.conf`. Ábrelo con el Bloc de notas.
5. **Copia TODO el contenido de ese archivo** (empieza con `[onedrive]`).
6. En Render → tu servicio → pestaña **Environment**:
   - Cambia `MODO` de `demo` a `produccion`.
   - Agrega una variable nueva: **KEY:** `RCLONE_CONFIG_CONTENT` — **VALUE:** pega ahí todo el contenido que copiaste (el cuadro de texto de Render acepta varias líneas tal cual, sin necesidad de comillas).
7. Guarda — Render redeploya solo. En el panel **Admin** de la app, la tarjeta "Estado de OneDrive" debería mostrar "OneDrive conectado ✅".

Todas las fotos quedarán organizadas en tu OneDrive dentro de la carpeta `Merch_HES/{tienda}/{año}/{mes}/Merch_XXXX.ext`.

**Nota sobre el plan Free de Render:** como no tiene disco persistente, si Render reinicia el contenedor no pierdes la conexión con OneDrive — el `RCLONE_CONFIG_CONTENT` sigue guardado como variable de entorno (no en disco), así que sobrevive a cualquier redeploy sin que tengas que reconectar nada.

## 5. Desplegar en Render (gratis para empezar)

1. Sube esta carpeta a un repositorio de GitHub (privado).
2. En Render.com → New → Web Service → conecta el repo, root directory `backend`.
3. Build command: `npm install` — Start command: `npm start`. (El `npm install` ya descarga rclone automáticamente, no necesitas instalarlo aparte en el servidor).
4. Agrega las variables de entorno (`MODO`, `JWT_SECRET`, `ONEDRIVE_ROOT_FOLDER` y, cuando conectes OneDrive, `RCLONE_CONFIG_CONTENT`).

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
    │   ├── graph.js          (OneDrive vía rclone + modo demo)
    ├── scripts/
    │   └── setup-rclone.sh   (descarga rclone durante npm install)
    ├── bin/                  (rclone descargado aquí — no se sube a git)
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
