/* Vencord PS5 - configuracion global */
#pragma once

#define VC_VERSION      "1.2.0"
#define VC_LISTEN_ADDR  "127.0.0.1"
#define VC_DEFAULT_PORT 8095

/* Origen real de Discord al que se reenvia todo. */
#define VC_UPSTREAM_DEFAULT "https://discord.com"

/* Build oficial de Vencord para navegador (userscript autocontenido, CSS incluido). */
#define VC_VENCORD_URL_DEFAULT \
  "https://github.com/Vendicated/Vencord/releases/download/devbuild/Vencord.user.js"

/* User-Agent moderno: el navegador de la PS5 se identifica como PlayStation
 * y Discord podria tratarlo como navegador no soportado. */
#define VC_SPOOF_UA \
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " \
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

#ifdef VC_PS5
#define VC_DATA_DIR "/data/vencord-ps5"
#else
#define VC_DATA_DIR "./data"
#endif

typedef struct vc_config {
  int  port;
  int  launch_browser;
  int  insecure_tls;
  char upstream[256];     /* p.ej. https://discord.com */
  char vencord_url[512];
  char data_dir[256];
  char self_origin[64];   /* http://127.0.0.1:8095 */
} vc_config_t;

extern vc_config_t g_cfg;
