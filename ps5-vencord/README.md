# Vencord PS5

App homebrew para usar **Discord con [Vencord](https://vencord.dev)** en una PS5 liberada (pensada para firmware 11.60).

La PS5 trae un navegador WebKit oculto, pero no acepta extensiones ni userscripts, y Discord bloquea la inyección de código con su CSP. Este payload lo resuelve así:

```
 Navegador PS5 ──http──▶ 127.0.0.1:8095 (payload) ──https──▶ discord.com
                         │ · quita CSP / HSTS / X-Frame-Options
                         │ · reescribe discord.com → 127.0.0.1:8095 en el HTML
                         │ · inyecta Vencord al principio de <head>
                         │ · se hace pasar por Chrome (User-Agent)
                         └ /__vc/fetch: puente para GM_xmlhttpRequest (temas, plugins)
```

- El HTTPS hacia Discord usa la librería TLS del propio sistema (`libSceHttp` + `libSceSsl`), así que no hace falta portar OpenSSL ni mbedTLS.
- Vencord es el **build web oficial** (`Vencord.user.js`) y va **incluido dentro del `.elf`**, así que no hace falta descargar nada en la consola. Con el botón "Actualizar Vencord" se baja la última versión, que se guarda en `/data/vencord-ps5/`.
- Si la verificación del certificado HTTPS falla en la consola (pasa a menudo con los payloads), se reintenta automáticamente sin verificar, igual que hace websrv.
- El servidor solo escucha en `127.0.0.1`, así que nadie de tu red puede usarlo.

## Requisitos

- PS5 liberada con un **cargador de ELF (elfldr)** escuchando en el puerto `9021`.
- Opcional: [websrv](https://github.com/ps5-payload-dev/websrv) (lanzador de homebrew en `http://127.0.0.1:8080`) para abrirla desde un menú.
- Conexión a Internet en la consola.

## Compilar

Con [ps5-payload-sdk](https://github.com/ps5-payload-dev/sdk):

```sh
sudo apt-get install clang-18 lld-18 wget unzip
wget https://github.com/ps5-payload-dev/sdk/releases/latest/download/ps5-payload-sdk.zip
sudo unzip -d /opt ps5-payload-sdk.zip
export PS5_PAYLOAD_SDK=/opt/ps5-payload-sdk

cd ps5-vencord
make            # -> vencord-ps5.elf
make homebrew   # -> dist/VencordPS5/ (eboot.elf + homebrew.js + icono)
```

O descarga el artefacto **VencordPS5** que genera el workflow `.github/workflows/ps5-vencord.yml` en GitHub Actions.

## Instalar y usar

### Opción A: enviar el ELF directamente

```sh
# desde el PC, con la PS5 en la misma red
make test PS5_HOST=192.168.1.50
# o bien:
nc -q0 192.168.1.50 9021 < vencord-ps5.elf
```

El payload se queda en segundo plano, muestra la notificación "Vencord PS5 listo" y abre el navegador en `http://127.0.0.1:8095/app`. Si lo envías otra vez mientras sigue en marcha, solo vuelve a abrir el navegador.

### Opción B: desde el lanzador de websrv

1. Copia `dist/VencordPS5/` a `/data/homebrew/VencordPS5/` por FTP (o a `homebrew/` de un USB).
2. Abre el Homebrew Launcher de websrv y elige **Vencord PS5**.
3. En las opciones del botón también puedes:
   - **Abrir sin verificar TLS**: úsala solo si la conexión con Discord falla por el certificado.
   - **Solo iniciar el servidor**: arranca el servidor sin abrir el navegador.

### Iniciar sesión

- Prueba primero con **correo y contraseña**.
- Si el captcha o el código QR no funcionan, abre `http://127.0.0.1:8095/__vc/login` y pega tu token. El token se saca en el PC: Discord web → DevTools → pestaña Network → cabecera `Authorization`. Se guarda solo en el navegador de la consola.

> ⚠️ El token da acceso total a tu cuenta. No lo compartas.

### Panel

`http://127.0.0.1:8095/__vc/` tiene botones para abrir Discord, iniciar sesión con token, **actualizar Vencord** a la última versión y ver un **diagnóstico de red** (`/__vc/diag`). El diagnóstico prueba la conexión con Discord y con GitHub y muestra el código de error exacto si algo falla.

### Opciones del payload

| Opción | Efecto |
|---|---|
| `--port N` | Puerto local (por defecto `8095`) |
| `--no-browser` | No abre el navegador |
| `--insecure` | Acepta certificados TLS inválidos |
| `--upstream URL` | Origen de Discord (por defecto `https://discord.com`; también vale `https://canary.discord.com`) |
| `--vencord-url URL` | De dónde descargar `Vencord.user.js` |
| `--data-dir DIR` | Carpeta de caché (por defecto `/data/vencord-ps5`) |

## Limitaciones

- **Llamadas de voz y vídeo:** lo más probable es que no funcionen, porque el navegador de la PS5 no tiene micrófono ni WebRTC completo. Texto, imágenes, servidores, MD, reacciones y plugins de Vencord sí funcionan.
- **Login por QR:** el servidor de Discord comprueba el origen de la página, así que es probable que el QR falle. Usa correo y contraseña o el token.
- **Adjuntos:** se suben directamente al almacenamiento de Discord. Si alguno falla, es por una limitación del navegador, no del proxy.
- **Normas de Discord:** sus Términos de Servicio no permiten clientes modificados. Vencord lleva años en uso sin baneos conocidos, pero úsalo bajo tu responsabilidad.
- **No probado en hardware real:** el proxy está probado en PC contra un Discord simulado, y Vencord real se cargó en Chromium. El código PS5 se comprobó contra las cabeceras y los stubs del SDK. Si algo falla en la consola, el log sale por la salida estándar del elfldr y por `klog`.

## Desarrollo y pruebas en el PC

```sh
make -f Makefile.host check
```

Esto compila un binario para Linux (backend HTTP sin TLS) y ejecuta `tests/test_proxy.py`, que levanta un Discord falso y comprueba lo siguiente:

- que se inyecta Vencord y se eliminan CSP y HSTS,
- la reescritura de URLs, cookies y redirecciones,
- el keep-alive con archivos de 3 MB,
- el reenvío de POST a la API,
- el puente `GM_xmlhttpRequest`,
- la protección contra otros orígenes y contra DNS rebinding,
- que se detecta una segunda instancia.

## Estructura

```
src/main.c            arranque, opciones, notificación, abre el navegador
src/proxy.c           servidor HTTP local + proxy inverso + reescritura
src/vencord.c         descarga y caché de Vencord.user.js
src/web.c             preludio JS (UA, GM_xmlhttpRequest), panel, login con token
src/upstream_sce.c    cliente HTTPS con libSceHttp (PS5)
src/upstream_posix.c  cliente HTTP plano (solo pruebas en PC)
homebrew/VencordPS5/  homebrew.js + icono para el lanzador de websrv
```

Licencia: GPL-3.0, igual que Vencord y ps5-payload-sdk.
