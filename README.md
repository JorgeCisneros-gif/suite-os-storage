# Deploy de suite-os-storage a serverj01

Guía paso a paso. **Sigue el orden estrictamente.**

## Lo que vamos a lograr

```
GitHub: JorgeCisneros-gif/suite-os-storage
   │
   │ push a main
   ▼
GitHub Actions → SSH vía Cloudflare Tunnel → serverj01
                                                  │
                                                  ▼
                                           ~/apps/suite-os-storage/
                                                  │
                                                  ▼
                                          docker compose up -d
                                                  │
                                                  ▼
                              ┌───────────────────────────────────┐
                              │ storage_db (postgres 16)          │
                              │ storage_redis                     │
                              │ storage_gateway (NestJS, port 3100)│
                              └───────────────────────────────────┘
                                                  │
                                                  ▼
                                        Red Docker: edify_network
                                                  │
                                                  ├─ DepartmentOS (existente) habla por http://storage_gateway:3100
                                                  └─ Cloudflare Tunnel expone storage.suite-os.app
```

---

## Pre-requisitos del repositorio

Archivos que deben estar en la raíz del repo:

```
suite-os-storage/
├── .github/workflows/deploy.yml      ← te lo paso
├── .env.example                      ← te lo paso
├── .gitignore                        ← ya lo tienes
├── docker-compose.yml                ← te lo paso (reemplaza el actual)
├── README.md                         ← este archivo
├── apps/storage-gateway/
│   ├── Dockerfile                    ← ya lo tienes (correcto)
│   └── src/                          ← tu código
└── temp-storage/                     ← se crea automáticamente
```

---

## PASO 1 — Configurar GitHub Secrets

Ve a:
`https://github.com/JorgeCisneros-gif/suite-os-storage/settings/secrets/actions`

Click **New repository secret** y crea estos 3 secrets:

| Nombre | Valor |
|--------|-------|
| `SSH_HOST` | `ssh.suite-os.app` |
| `SSH_USER` | `jorge` |
| `SSH_PRIVATE_KEY` | Contenido completo de tu clave privada SSH |

> ### ¿De dónde sacar SSH_PRIVATE_KEY?
> En tu laptop Windows ejecuta en PowerShell:
> ```powershell
> type $env:USERPROFILE\.ssh\id_ed25519
> # o si es RSA:
> type $env:USERPROFILE\.ssh\id_rsa
> ```
> Copia TODO el contenido (incluyendo las líneas `-----BEGIN...-----` y `-----END...-----`).

---

## PASO 2 — Configurar OAuth Google para producción

Ve a https://console.cloud.google.com/apis/credentials

### Opción A — Reutilizar tu OAuth Client actual

Si el OAuth actual está en "Testing mode" y tú eres el único test user, puedes simplemente **agregar la URL de producción** como redirect autorizado:

1. Click en tu OAuth Client ID actual
2. En **Authorized redirect URIs**, agrega:
   ```
   https://storage.suite-os.app/api/v1/auth/google/callback
   ```
3. Guardar

Vas a usar el MISMO `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en producción.

### Opción B — Crear OAuth Client nuevo para prod

Recomendado si quieres separar dev/prod:

1. **Create Credentials** → **OAuth client ID**
2. Application type: **Web application**
3. Name: `Suite-OS Storage (Production)`
4. Authorized redirect URIs:
   ```
   https://storage.suite-os.app/api/v1/auth/google/callback
   ```
5. Guarda y copia el nuevo `client_id` y `client_secret`

> **Nota sobre verificación de Google:**
> Mientras tu app esté en Testing Mode, solo los emails listados como
> "Test users" pueden conectar Drive. Para uso real con clientes,
> necesitas pasar la app a "Production" y eso requiere el proceso de
> verificación de Google (1-3 semanas). Por ahora puedes seguir en
> Testing Mode y agregar como test users a los emails de tus primeros
> clientes.

---

## PASO 3 — Actualizar Cloudflare Tunnel (UNA SOLA VEZ, en el server)

Vía SSH al server:

```bash
ssh jorge@ssh.suite-os.app

# Editar config
sudo nano /etc/cloudflared/config.yml
```

Reemplaza el contenido con:

```yaml
tunnel: suiteos-tunnel
credentials-file: /etc/cloudflared/b2560e7d-4286-4351-b1e3-c88d0efd680c.json

ingress:
  - hostname: deparmentos.suite-os.app
    service: http://localhost:80

  - hostname: suite-os.app
    service: http://localhost:8080

  - hostname: www.suite-os.app
    service: http://localhost:8080

  - hostname: ssh.suite-os.app
    service: ssh://localhost:22

  # NUEVO: Storage Gateway (apunta al container vía red Docker)
  - hostname: storage.suite-os.app
    service: http://storage_gateway:3100

  - service: http_status:404
```

> **Importante**: `http://storage_gateway:3100` solo funcionará si
> cloudflared está corriendo en el host pero puede resolver containers.
> En tu setup actual cloudflared corre como servicio systemd nativo
> (no en Docker), por lo que necesitamos exponer el puerto.

**Hay 2 alternativas. Elige una:**

### Alternativa 1 (más fácil): Exponer puerto 3100 en localhost

En `docker-compose.yml` del storage, descomentar:
```yaml
storage_gateway:
  ports:
    - "127.0.0.1:3100:3100"   # solo localhost, no público
```

Y en cloudflared config:
```yaml
- hostname: storage.suite-os.app
  service: http://localhost:3100
```

✅ Simple, funciona inmediato.
⚠️ El puerto 3100 queda accesible localmente al server (no público, pero sí desde otros procesos del server).

### Alternativa 2 (más limpia): Cloudflared en Docker

Mover cloudflared a un container que comparta `edify_network`. Más cambio pero mejor aislamiento. Lo dejamos para más adelante.

**Recomendación inmediata: Alternativa 1.**

Después de elegir y editar el config, reiniciar:

```bash
sudo systemctl restart cloudflared
sudo systemctl status cloudflared --no-pager | head -15
```

Y crear el DNS:
```bash
cloudflared tunnel route dns suiteos-tunnel storage.suite-os.app
```

---

## PASO 4 — Setup inicial del repo en el server (UNA SOLA VEZ)

Vía SSH:

```bash
ssh jorge@ssh.suite-os.app

# 1. Ir al directorio de apps
cd ~/apps

# 2. Clonar el repo
git clone https://github.com/JorgeCisneros-gif/suite-os-storage.git
cd suite-os-storage

# 3. Crear el .env con los valores reales de producción
cp .env.example .env
nano .env
```

En el `.env`, completa CADA campo. Para generar los valores aleatorios:

```bash
# Genera y guarda estos en tu nano:

echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)"
echo "REDIS_PASSWORD=$(openssl rand -hex 16)"
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"
echo "INTERNAL_API_KEY=$(openssl rand -hex 24)"
```

> **⚠️ Importante**: el `INTERNAL_API_KEY` también debe ir en el .env de
> DepartmentOS como `STORAGE_GATEWAY_API_KEY`. Más sobre esto en el Paso 6.

Para `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`, pega los valores del Paso 2.

Guarda con `Ctrl+O`, `Enter`, `Ctrl+X`.

---

## PASO 5 — Primer arranque

```bash
cd ~/apps/suite-os-storage

# Build y arrancar
docker compose up -d --build

# Ver logs
docker compose logs -f storage_gateway
```

Espera ~30 segundos. Deberías ver:

```
[xx:xx:xx] INFO: Storage Gateway corriendo en puerto 3100
[xx:xx:xx] INFO: Swagger disponible en http://localhost:3100/docs
[xx:xx:xx] INFO: Ambiente: production
```

Verifica desde tu máquina:

```powershell
curl https://storage.suite-os.app/api/v1/health
```

Esperado:
```json
{
  "status": "ok",
  "service": "suite-os-storage-gateway",
  "ts": "2026-06-22T..."
}
```

---

## PASO 6 — Conectar DepartmentOS al storage gateway

Edita el `.env` de DepartmentOS en el server:

```bash
nano ~/apps/deparmentOS/.env
```

Agrega al final:

```env
# ── Storage Gateway ──────────────────────────────────────────
# DepartmentOS llama al gateway por la red Docker interna
STORAGE_GATEWAY_URL=http://storage_gateway:3100/api/v1
STORAGE_GATEWAY_API_KEY=<el-INTERNAL_API_KEY-del-storage>
```

El valor de `STORAGE_GATEWAY_API_KEY` debe ser **el mismo** que pusiste
en `INTERNAL_API_KEY` del storage. Sino, todos los requests fallan con
401 Unauthorized.

Reinicia DepartmentOS para que tome los cambios:

```bash
cd ~/apps/deparmentOS
docker compose restart backend
```

Verifica que la integración funciona desde tu máquina:

```powershell
# Login a DepartmentOS
curl -X POST https://deparmentos.suite-os.app/api/v1/auth/login `
  -H "Content-Type: application/json" `
  -d '{"email":"supervisor@deparmentOs.com","password":"<tu-password>"}'

# Copia el accessToken y úsalo:
curl https://deparmentos.suite-os.app/api/v1/storage/health `
  -H "Authorization: Bearer <accessToken>"
```

Esperado: `{"status":"ok",...}` 

---

## PASO 7 — Activar GitHub Actions

Ya está todo listo. La próxima vez que hagas `git push` al main, Actions
hará deploy automático.

Verifica que el workflow está correctamente configurado:

```
https://github.com/JorgeCisneros-gif/suite-os-storage/actions
```

Para hacer un deploy de prueba sin cambios reales:
1. Ve a Actions → `Deploy to serverj01`
2. Click **Run workflow** → **Run workflow**

---

## Comandos útiles después del deploy

### Ver logs en tiempo real
```bash
ssh jorge@ssh.suite-os.app
cd ~/apps/suite-os-storage
docker compose logs -f storage_gateway
```

### Reiniciar solo el gateway (sin tocar DB/Redis)
```bash
docker compose restart storage_gateway
```

### Ver storage temporal
```bash
docker compose exec storage_gateway ls -la /var/lib/suite-storage/temp/
# o desde el host:
ls -la ~/apps/suite-os-storage/temp-storage/
```

### Backup del Postgres del storage
```bash
docker compose exec storage_db pg_dump -U storage_user suite_storage > backup_$(date +%Y%m%d).sql
```

### Si algo se rompe — rollback
```bash
git log --oneline -10                  # ver últimos commits
git reset --hard <hash-commit-anterior>
docker compose up -d --build storage_gateway
```

---

## Checklist final pre-deploy

Antes de hacer el primer `docker compose up`:

- [ ] Cloudflared config.yml actualizado con `storage.suite-os.app`
- [ ] `cloudflared tunnel route dns` ejecutado
- [ ] OAuth Client con redirect URI de producción
- [ ] GitHub Secrets configurados en el repo
- [ ] `.env` creado en el server con TODOS los valores
- [ ] `apps/storage-gateway/Dockerfile` existe y compila
- [ ] `edify_network` existe en el server (`docker network ls`)

## Troubleshooting

### "network edify_network not found"
```bash
docker network create edify_network
# Pero esto no debería pasar si DepartmentOS ya está corriendo
```

### Gateway no arranca, logs muestran error de DB
```bash
# Verificar que el storage_db está healthy
docker compose ps
# Si no está healthy, ver sus logs
docker compose logs storage_db
```

### `storage.suite-os.app` da 502 o no carga
```bash
# Verificar que cloudflared puede ver el puerto
sudo systemctl status cloudflared
# Verificar el config
sudo cat /etc/cloudflared/config.yml
# Reiniciar
sudo systemctl restart cloudflared
```

### DepartmentOS recibe 401 del gateway
- Verificar que `STORAGE_GATEWAY_API_KEY` en DepartmentOS coincide con
  `INTERNAL_API_KEY` en storage
- Ambos deben ser EXACTAMENTE el mismo valor (sin espacios)
