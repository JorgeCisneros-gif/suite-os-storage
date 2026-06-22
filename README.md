# suite-os-storage

Microservicio de almacenamiento delegado para el ecosistema **Suite-OS**.

Permite que cada organización aloje sus propios archivos en su Google Drive,
con fallback automático a storage interno con política de retención limitada.

---

## Arquitectura

```
DepartmentOS API ──┐
                   ├──► Storage Gateway :3100 ──► Google Drive del usuario
InventoryOS API  ──┘         │
                             └──► Storage interno (fallback temporal)

Redes Docker:
  storage_external  → solo el gateway (puerto 3100)
  storage_internal  → gateway + postgres + redis (nadie de afuera)
```

---

## Inicio rápido

### 1. Configurar variables de entorno

```bash
cp .env.example .env
# Editar .env con tus valores
```

Generar claves seguras:
```bash
openssl rand -hex 32   # para ENCRYPTION_KEY
openssl rand -hex 24   # para INTERNAL_API_KEY y JWT_SECRET
```

### 2. Configurar Google OAuth2

1. Ir a [console.cloud.google.com](https://console.cloud.google.com)
2. Crear proyecto `suite-os-storage`
3. APIs & Services → Credenciales → Crear credencial OAuth 2.0
4. Tipo: Aplicación web
5. URIs de redireccionamiento autorizados:
   - `https://storage.suite-os.app/api/v1/auth/google/callback` (producción)
   - `http://localhost:3100/api/v1/auth/google/callback` (desarrollo)
6. Copiar Client ID y Client Secret al `.env`

### 3. Levantar servicios

**Producción:**
```bash
docker compose up -d
```

**Desarrollo (con pgAdmin en localhost:5050):**
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

---

## Uso desde otras apps

### Autenticación
Todas las peticiones llevan el header:
```
x-api-key: {INTERNAL_API_KEY}
```

### Subir un archivo

```bash
curl -X POST http://storage-gateway:3100/api/v1/files/upload \
  -H "x-api-key: tu_api_key" \
  -F "orgId=uuid-de-la-org" \
  -F "appSource=departmentos" \
  -F "entityType=meter_reading" \
  -F "entityId=uuid-del-registro" \
  -F "subFolder=Lecturas" \
  -F "file=@foto_medidor.jpg"

# Respuesta:
{
  "fileId": "uuid",
  "status": "stored_external",   # o "stored_temporary" / "pending_retry"
  "expiresAt": null,             # null = en Drive del usuario, no expira
  "storageType": "google_drive"
}
```

### Obtener URL de descarga

```bash
curl "http://storage-gateway:3100/api/v1/files/{fileId}/url?orgId={orgId}" \
  -H "x-api-key: tu_api_key"
```

### Iniciar conexión de Drive (desde frontend del usuario)

```
GET /api/v1/auth/google/connect?orgId={orgId}&appSource=departmentos
```
Redirige al usuario a Google → el usuario acepta → vuelve a tu app.

### Estado del storage de una org

```bash
curl "http://storage-gateway:3100/api/v1/providers/{orgId}?appSource=departmentos" \
  -H "x-api-key: tu_api_key"
```

---

## Políticas de retención

| Situación | Storage | Retención |
|-----------|---------|-----------|
| Drive conectado y OK | Drive del usuario | Indefinida |
| Sin Drive configurado | Interno | 90 días (DEFAULT_RETENTION_DAYS) |
| Error de Drive | Interno | 30 días (ERROR_RETENTION_DAYS) |
| Sin espacio en Drive | Interno | 30 días + alerta |
| Token revocado | Interno | 30 días + alerta |

---

## Jobs automáticos

| Job | Frecuencia | Acción |
|-----|------------|--------|
| Reintentar uploads | Cada hora | Reintenta archivos `pending_retry` (máx 3 veces) |
| Notificar expiración | Diario 2am | Avisa a 15 días y 3 días antes de expirar |
| Eliminar expirados | Diario 2am | Borra archivos con `expires_at` vencido |
| Health check Drive | Diario 8am | Verifica espacio y tokens de todos los providers |

---

## Seguridad

- **PostgreSQL y Redis**: solo accesibles dentro de la red Docker interna (`storage_internal`), sin puertos expuestos al host en producción.
- **Credenciales OAuth**: cifradas con AES-256 antes de guardarse en DB.
- **API Key**: header `x-api-key` requerido en todos los endpoints (excepto `/health` y el callback OAuth).
- **Scope de Drive**: se solicita `drive.file` — la app solo puede ver/editar archivos que ella misma creó, no el Drive completo del usuario.

---

## Estructura del proyecto

```
suite-os-storage/
├── docker-compose.yml          # producción
├── docker-compose.dev.yml      # override para desarrollo
├── .env.example
├── postgres/
│   └── init/
│       └── 01_schema.sql       # schema inicial automático
└── apps/
    └── storage-gateway/        # NestJS + Fastify
        ├── Dockerfile
        ├── src/
        │   ├── main.ts
        │   ├── credentials/    # cifrado AES-256
        │   ├── providers/
        │   │   └── google-drive/
        │   ├── storage/        # lógica principal + controller
        │   └── jobs/           # cron de mantenimiento
        └── package.json
```
