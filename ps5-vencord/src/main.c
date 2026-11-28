/* Vencord PS5 - payload homebrew para PS5 liberada.
 *
 * Levanta un proxy local en http://127.0.0.1:8095 que sirve Discord web
 * con Vencord inyectado y abre el navegador del sistema en esa direccion.
 *
 * Uso (todos opcionales):
 *   --port N          puerto local (8095)
 *   --no-browser      no abrir el navegador automaticamente
 *   --insecure        aceptar certificados TLS invalidos (solo si falla TLS)
 *   --upstream URL    origen de Discord (https://discord.com)
 *   --vencord-url URL de donde descargar Vencord.user.js
 *   --data-dir DIR    carpeta de cache (/data/vencord-ps5)
 */
#include <pthread.h>
#include <signal.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <unistd.h>

#include "config.h"
#include "proxy.h"
#include "upstream.h"
#include "vencord.h"

vc_config_t g_cfg;

#ifdef VC_PS5
typedef struct notify_request {
  char useless1[45];
  char message[3075];
} notify_request_t;

int sceKernelSendNotificationRequest(int, notify_request_t *, size_t, int);
int sceUserServiceInitialize(void *);
int sceSystemServiceLaunchWebBrowser(const char *uri, void *);
#endif

static void
notify(const char *fmt, ...) {
  char msg[1024];
  va_list ap;

  va_start(ap, fmt);
  vsnprintf(msg, sizeof(msg), fmt, ap);
  va_end(ap);
  printf("[vc] %s\n", msg);
#ifdef VC_PS5
  {
    notify_request_t req;
    memset(&req, 0, sizeof(req));
    snprintf(req.message, sizeof(req.message), "%s", msg);
    sceKernelSendNotificationRequest(0, &req, sizeof(req), 0);
  }
#endif
}

static void
open_browser(void) {
  char url[128];
  snprintf(url, sizeof(url), "%s/app", g_cfg.self_origin);
#ifdef VC_PS5
  sceUserServiceInitialize(0);
  if(sceSystemServiceLaunchWebBrowser(url, 0)) {
    notify("Vencord PS5: abre el navegador en %s", url);
  }
#else
  printf("[vc] abre %s en el navegador\n", url);
#endif
}

static void *
prefetch_thread(void *arg) {
  size_t len;
  (void)arg;
  if(!vencord_get(&len)) {
    notify("Vencord PS5: no se pudo descargar Vencord. "
           "Discord funcionara sin mods.");
  }
  return 0;
}

static void
parse_args(int argc, char **argv) {
  const char *env;

  g_cfg.port = VC_DEFAULT_PORT;
  g_cfg.launch_browser = 1;
  snprintf(g_cfg.upstream, sizeof(g_cfg.upstream), "%s", VC_UPSTREAM_DEFAULT);
  snprintf(g_cfg.vencord_url, sizeof(g_cfg.vencord_url), "%s",
           VC_VENCORD_URL_DEFAULT);
  snprintf(g_cfg.data_dir, sizeof(g_cfg.data_dir), "%s", VC_DATA_DIR);

  if((env = getenv("VC_PORT"))) g_cfg.port = atoi(env);
  if((env = getenv("VC_UPSTREAM")))
    snprintf(g_cfg.upstream, sizeof(g_cfg.upstream), "%s", env);
  if((env = getenv("VC_VENCORD_URL")))
    snprintf(g_cfg.vencord_url, sizeof(g_cfg.vencord_url), "%s", env);
  if((env = getenv("VC_DATA_DIR")))
    snprintf(g_cfg.data_dir, sizeof(g_cfg.data_dir), "%s", env);

  /* argv[0] puede faltar o no ser la ruta segun el lanzador: se recorren
   * todos los argumentos buscando opciones. */
  for(int i = 0; i < argc; i++) {
    const char *a = argv[i];
    if(!a) continue;
    if(!strcmp(a, "--no-browser")) g_cfg.launch_browser = 0;
    else if(!strcmp(a, "--insecure")) g_cfg.insecure_tls = 1;
    else if(!strcmp(a, "--port") && i + 1 < argc) g_cfg.port = atoi(argv[++i]);
    else if(!strcmp(a, "--upstream") && i + 1 < argc)
      snprintf(g_cfg.upstream, sizeof(g_cfg.upstream), "%s", argv[++i]);
    else if(!strcmp(a, "--vencord-url") && i + 1 < argc)
      snprintf(g_cfg.vencord_url, sizeof(g_cfg.vencord_url), "%s", argv[++i]);
    else if(!strcmp(a, "--data-dir") && i + 1 < argc)
      snprintf(g_cfg.data_dir, sizeof(g_cfg.data_dir), "%s", argv[++i]);
  }
  if(g_cfg.port <= 0 || g_cfg.port > 65535) g_cfg.port = VC_DEFAULT_PORT;

  /* sin barra final */
  size_t l = strlen(g_cfg.upstream);
  while(l && g_cfg.upstream[l - 1] == '/') g_cfg.upstream[--l] = 0;

  snprintf(g_cfg.self_origin, sizeof(g_cfg.self_origin), "http://127.0.0.1:%d",
           g_cfg.port);
}

int
main(int argc, char **argv) {
  pthread_t th;
  int fd, in_use;

  signal(SIGPIPE, SIG_IGN);
  setvbuf(stdout, 0, _IONBF, 0);
  parse_args(argc, argv);

  printf("[vc] Vencord PS5 %s\n", VC_VERSION);

  fd = proxy_listen(&in_use);
  if(fd < 0) {
    if(in_use) {
      /* Ya hay una instancia corriendo: solo abrimos el navegador. */
      notify("Vencord PS5 ya estaba en marcha");
      if(g_cfg.launch_browser) open_browser();
      return 0;
    }
    notify("Vencord PS5: no se pudo abrir el puerto %d", g_cfg.port);
    return 1;
  }

  if(up_init(g_cfg.insecure_tls)) {
    notify("Vencord PS5: error iniciando la red/TLS del sistema");
    return 1;
  }

  pthread_create(&th, 0, prefetch_thread, 0);
  pthread_detach(th);

  notify("Vencord PS5 listo en %s", g_cfg.self_origin);
  if(g_cfg.launch_browser) open_browser();

  proxy_serve(fd);
  return 0;
}
